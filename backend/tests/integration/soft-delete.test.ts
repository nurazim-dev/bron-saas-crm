import { beforeEach, describe, expect, it } from 'vitest';
import { prisma, prismaUnfiltered } from '../../src/lib/prisma.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

describe('soft-delete extension (§3.3)', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('rewrites delete into an update that sets deletedAt and hides the row from find*/count/aggregate/groupBy', async () => {
    const company = await createCompanyFactory();
    const s1 = await createServiceFactory(company.id, { name: 'Active Service' });
    const s2 = await createServiceFactory(company.id, { name: 'Deleted Service' });

    const deleted = await prisma.service.delete({ where: { id: s2.id } });
    expect(deleted.deletedAt).toBeInstanceOf(Date);

    // Default client hides the soft-deleted service
    expect(await prisma.service.findUnique({ where: { id: s2.id } })).toBeNull();
    await expect(prisma.service.findUniqueOrThrow({ where: { id: s2.id } })).rejects.toMatchObject({
      code: 'P2025',
    });
    expect(await prisma.service.findFirst({ where: { id: s2.id } })).toBeNull();
    await expect(prisma.service.findFirstOrThrow({ where: { id: s2.id } })).rejects.toThrow();

    const list = await prisma.service.findMany({ where: { companyId: company.id } });
    expect(list.map((s) => s.id)).toEqual([s1.id]);

    expect(await prisma.service.count({ where: { companyId: company.id } })).toBe(1);

    const agg = await prisma.service.aggregate({
      where: { companyId: company.id },
      _count: { _all: true },
    });
    expect(agg._count._all).toBe(1);

    const grouped = await prisma.service.groupBy({
      by: ['companyId'],
      where: { companyId: company.id },
      _count: { _all: true },
    });
    expect(grouped[0]?._count._all).toBe(1);

    // Unfiltered client still sees the soft-deleted row
    const rawRow = await prismaUnfiltered.service.findUnique({ where: { id: s2.id } });
    expect(rawRow).not.toBeNull();
    expect(rawRow?.deletedAt).toBeInstanceOf(Date);
  });

  it('prevents update and updateMany from modifying soft-deleted rows', async () => {
    const company = await createCompanyFactory();
    const user = await createUserFactory(company.id, { name: 'Before Delete' });

    await prisma.user.delete({ where: { id: user.id } });

    await expect(
      prisma.user.update({
        where: { id: user.id },
        data: { name: 'Should Not Update' },
      }),
    ).rejects.toThrow();

    const batchResult = await prisma.user.updateMany({
      where: { id: user.id },
      data: { name: 'Should Not Update Either' },
    });
    expect(batchResult.count).toBe(0);

    const unfilteredUser = await prismaUnfiltered.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(unfilteredUser.name).toBe('Before Delete');
  });

  it('rewrites deleteMany into updateMany setting deletedAt on non-deleted rows only', async () => {
    const company = await createCompanyFactory();
    await createServiceFactory(company.id);
    await createServiceFactory(company.id);

    const delResult = await prisma.service.deleteMany({ where: { companyId: company.id } });
    expect(delResult.count).toBe(2);

    expect(await prisma.service.count({ where: { companyId: company.id } })).toBe(0);
    expect(await prismaUnfiltered.service.count({ where: { companyId: company.id } })).toBe(2);
  });

  it('preserves historical readability on appointments when service or master is soft-deleted, while allowing explicit filtering on child collections', async () => {
    const company = await createCompanyFactory();
    const master = await createUserFactory(company.id, { name: 'Master Historical' });
    const activeService = await createServiceFactory(company.id, { name: 'Keep Service' });
    const deletedService = await createServiceFactory(company.id, { name: 'Legacy Service' });

    const appt = await createAppointmentFactory({
      companyId: company.id,
      masterId: master.id,
      serviceId: deletedService.id,
    });

    await prisma.service.delete({ where: { id: deletedService.id } });
    await prisma.user.delete({ where: { id: master.id } });

    // Nested include on Appointment still loads soft-deleted master and service so history stays readable
    const loadedAppt = await prisma.appointment.findUniqueOrThrow({
      where: { id: appt.id },
      include: { master: true, service: true },
    });
    expect(loadedAppt.master.name).toBe('Master Historical');
    expect(loadedAppt.master.deletedAt).toBeInstanceOf(Date);
    expect(loadedAppt.service.name).toBe('Legacy Service');
    expect(loadedAppt.service.deletedAt).toBeInstanceOf(Date);

    // Child collections on Company can explicitly filter out deleted rows with where: { deletedAt: null }
    const companyWithActiveServices = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
      include: {
        services: { where: { deletedAt: null } },
      },
    });
    expect(companyWithActiveServices.services.map((s) => s.id)).toEqual([activeService.id]);
  });

  it('hard-deletes pure link/config tables (MasterService, WorkingHours)', async () => {
    const company = await createCompanyFactory();
    const master = await createUserFactory(company.id);
    const service = await createServiceFactory(company.id);

    await prisma.masterService.create({
      data: { userId: master.id, serviceId: service.id },
    });
    const wh = await prisma.workingHours.create({
      data: { userId: master.id, dayOfWeek: 1, startTime: '10:00', endTime: '19:00' },
    });

    await prisma.masterService.delete({
      where: { userId_serviceId: { userId: master.id, serviceId: service.id } },
    });
    await prisma.workingHours.delete({ where: { id: wh.id } });

    expect(await prismaUnfiltered.masterService.count()).toBe(0);
    expect(await prismaUnfiltered.workingHours.count()).toBe(0);
  });
});
