import { beforeEach, describe, expect, it } from 'vitest';
import { AppointmentStatus, Prisma } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';
import { isExclusionConstraintError } from '../../src/middleware/error-handler.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

describe('database constraints & timestamptz UTC behavior', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  describe('Appointment exclusion constraint (no overlapping active slots per master)', () => {
    it('rejects overlapping SCHEDULED appointments for the same master with SQLSTATE 23P01', async () => {
      const company = await createCompanyFactory();
      const master = await createUserFactory(company.id);
      const service = await createServiceFactory(company.id);

      await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt: new Date('2026-11-20T04:00:00.000Z'),
        endAt: new Date('2026-11-20T05:00:00.000Z'),
        status: AppointmentStatus.SCHEDULED,
      });

      let caughtError: unknown;
      try {
        await createAppointmentFactory({
          companyId: company.id,
          masterId: master.id,
          serviceId: service.id,
          startAt: new Date('2026-11-20T04:30:00.000Z'),
          endAt: new Date('2026-11-20T05:30:00.000Z'),
          status: AppointmentStatus.SCHEDULED,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(isExclusionConstraintError(caughtError)).toBe(true);
    });

    it('rejects overlapping when existing appointment is COMPLETED', async () => {
      const company = await createCompanyFactory();
      const master = await createUserFactory(company.id);
      const service = await createServiceFactory(company.id);

      await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt: new Date('2026-11-20T04:00:00.000Z'),
        endAt: new Date('2026-11-20T05:00:00.000Z'),
        status: AppointmentStatus.COMPLETED,
      });

      await expect(
        createAppointmentFactory({
          companyId: company.id,
          masterId: master.id,
          serviceId: service.id,
          startAt: new Date('2026-11-20T04:00:00.000Z'),
          endAt: new Date('2026-11-20T05:00:00.000Z'),
          status: AppointmentStatus.SCHEDULED,
        }),
      ).rejects.toThrow();
    });

    it('allows back-to-back (adjacent) appointments where endAt == next startAt', async () => {
      const company = await createCompanyFactory();
      const master = await createUserFactory(company.id);
      const service = await createServiceFactory(company.id);

      const first = await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt: new Date('2026-11-20T04:00:00.000Z'),
        endAt: new Date('2026-11-20T05:00:00.000Z'),
      });

      const second = await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt: new Date('2026-11-20T05:00:00.000Z'),
        endAt: new Date('2026-11-20T06:00:00.000Z'),
      });

      expect(first.endAt.toISOString()).toBe(second.startAt.toISOString());
    });

    it('does not block when an overlapping appointment is CANCELLED, NO_SHOW, or soft-deleted', async () => {
      const company = await createCompanyFactory();
      const master = await createUserFactory(company.id);
      const service = await createServiceFactory(company.id);

      const startAt = new Date('2026-11-20T04:00:00.000Z');
      const endAt = new Date('2026-11-20T05:00:00.000Z');

      await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt,
        endAt,
        status: AppointmentStatus.CANCELLED,
      });

      await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt,
        endAt,
        status: AppointmentStatus.NO_SHOW,
      });

      const toDelete = await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt,
        endAt,
        status: AppointmentStatus.SCHEDULED,
      });
      await prisma.appointment.delete({ where: { id: toDelete.id } });

      const active = await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt,
        endAt,
        status: AppointmentStatus.SCHEDULED,
      });

      expect(active.id).toBeDefined();
    });

    it('allows two different masters to have appointments at the exact same time', async () => {
      const company = await createCompanyFactory();
      const masterA = await createUserFactory(company.id);
      const masterB = await createUserFactory(company.id);
      const service = await createServiceFactory(company.id);

      const startAt = new Date('2026-11-20T04:00:00.000Z');
      const endAt = new Date('2026-11-20T05:00:00.000Z');

      const apptA = await createAppointmentFactory({
        companyId: company.id,
        masterId: masterA.id,
        serviceId: service.id,
        startAt,
        endAt,
      });

      const apptB = await createAppointmentFactory({
        companyId: company.id,
        masterId: masterB.id,
        serviceId: service.id,
        startAt,
        endAt,
      });

      expect(apptA.id).not.toBe(apptB.id);
    });
  });

  describe('CHECK constraints (§3.5)', () => {
    it('enforces Appointment endAt > startAt', async () => {
      const company = await createCompanyFactory();
      const master = await createUserFactory(company.id);
      const service = await createServiceFactory(company.id);
      const instant = new Date('2026-11-20T04:00:00.000Z');

      await expect(
        createAppointmentFactory({
          companyId: company.id,
          masterId: master.id,
          serviceId: service.id,
          startAt: instant,
          endAt: instant,
        }),
      ).rejects.toThrow();

      await expect(
        createAppointmentFactory({
          companyId: company.id,
          masterId: master.id,
          serviceId: service.id,
          startAt: instant,
          endAt: new Date(instant.getTime() - 60_000),
        }),
      ).rejects.toThrow();
    });

    it('enforces Service durationMin BETWEEN 5 AND 720 and price >= 0', async () => {
      const company = await createCompanyFactory();

      await expect(createServiceFactory(company.id, { durationMin: 4 })).rejects.toThrow();
      await expect(createServiceFactory(company.id, { durationMin: 721 })).rejects.toThrow();
      await expect(
        createServiceFactory(company.id, { price: new Prisma.Decimal('-1.00') }),
      ).rejects.toThrow();

      const validZero = await createServiceFactory(company.id, {
        durationMin: 5,
        price: new Prisma.Decimal('0.00'),
      });
      expect(validZero.price.toFixed(2)).toBe('0.00');
    });

    it('enforces WorkingHours dayOfWeek BETWEEN 1 AND 7', async () => {
      const company = await createCompanyFactory();
      const master = await createUserFactory(company.id);

      await expect(
        prisma.workingHours.create({
          data: { userId: master.id, dayOfWeek: 0, startTime: '09:00', endTime: '18:00' },
        }),
      ).rejects.toThrow();

      await expect(
        prisma.workingHours.create({
          data: { userId: master.id, dayOfWeek: 8, startTime: '09:00', endTime: '18:00' },
        }),
      ).rejects.toThrow();

      const valid = await prisma.workingHours.create({
        data: { userId: master.id, dayOfWeek: 7, startTime: '09:00', endTime: '18:00' },
      });
      expect(valid.dayOfWeek).toBe(7);
    });

    it('enforces Company slotIntervalMin (5..120), minLeadTimeMin (>= 0), maxAdvanceDays (1..365)', async () => {
      await expect(createCompanyFactory({ slotIntervalMin: 4 })).rejects.toThrow();
      await expect(createCompanyFactory({ slotIntervalMin: 121 })).rejects.toThrow();
      await expect(createCompanyFactory({ minLeadTimeMin: -1 })).rejects.toThrow();
      await expect(createCompanyFactory({ maxAdvanceDays: 0 })).rejects.toThrow();
      await expect(createCompanyFactory({ maxAdvanceDays: 366 })).rejects.toThrow();
    });
  });

  describe('timestamptz UTC round-trip', () => {
    it('stores and retrieves instants in UTC with millisecond precision', async () => {
      const company = await createCompanyFactory();
      const master = await createUserFactory(company.id);
      const service = await createServiceFactory(company.id);

      const startAt = new Date('2026-11-20T04:00:00.123Z');
      const endAt = new Date('2026-11-20T05:00:00.456Z');

      const created = await createAppointmentFactory({
        companyId: company.id,
        masterId: master.id,
        serviceId: service.id,
        startAt,
        endAt,
      });

      const loaded = await prisma.appointment.findUniqueOrThrow({ where: { id: created.id } });
      expect(loaded.startAt.toISOString()).toBe('2026-11-20T04:00:00.123Z');
      expect(loaded.endAt.toISOString()).toBe('2026-11-20T05:00:00.456Z');
    });
  });
});
