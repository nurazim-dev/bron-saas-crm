import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  AppointmentSource,
  AppointmentStatus,
  NotificationChannel,
  OutboxStatus,
  Prisma,
  Role,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

describe('Phase 26: Performance, EXPLAIN Index Checks & Concurrency Load Test', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    setClock(new FakeClock(DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate()));
  });

  afterEach(() => {
    resetClock();
  });

  it('uses indexes in EXPLAIN across appointments, clients, and outbox queries on ~5k rows', async () => {
    const company = await createCompanyFactory();
    const master = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id);

    const clientsData = Array.from({ length: 500 }, (_, i) => ({
      companyId: company.id,
      name: `Client ${i}`,
      phone: `+996555${String(100000 + i).slice(-6)}`,
    }));
    await prisma.client.createMany({ data: clientsData });
    const oneClient = await prisma.client.findFirstOrThrow({ where: { companyId: company.id } });

    const baseMs = DateTime.fromISO('2026-10-01T00:00:00.000Z').toMillis();
    const apptsData = Array.from({ length: 5000 }, (_, i) => ({
      companyId: company.id,
      masterId: master.id,
      serviceId: service.id,
      clientId: oneClient.id,
      clientName: oneClient.name,
      clientPhone: oneClient.phone,
      startAt: DateTime.fromMillis(baseMs + i * 600_000).toJSDate(),
      endAt: DateTime.fromMillis(baseMs + i * 600_000 + 300_000).toJSDate(),
      price: new Prisma.Decimal('500.00'),
      status: AppointmentStatus.SCHEDULED,
      source: AppointmentSource.ONLINE,
      manageToken: `perf-tok-${i}-${randomUUID().slice(0, 8)}`,
    }));
    await prisma.appointment.createMany({ data: apptsData });

    const outboxData = Array.from({ length: 1000 }, (_, i) => ({
      companyId: company.id,
      channel: NotificationChannel.EMAIL,
      status: OutboxStatus.PENDING,
      recipient: `user${i}@test.kg`,
      kind: 'TEST',
      dedupeKey: `perf-dedupe-${i}-${randomUUID()}`,
      payload: { i },
      scheduledFor: DateTime.fromMillis(baseMs + i * 1000).toJSDate(),
    }));
    await prisma.outboxMessage.createMany({ data: outboxData });

    await prisma.$executeRaw`ANALYZE "Appointment", "Client", "OutboxMessage"`;

    const fromUtc = DateTime.fromISO('2026-10-10T00:00:00.000Z').toJSDate();
    const toUtc = DateTime.fromISO('2026-10-12T00:00:00.000Z').toJSDate();

    const apptPlan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN SELECT * FROM "Appointment"
      WHERE "companyId" = ${company.id}::uuid
        AND "deletedAt" IS NULL
        AND "startAt" >= ${fromUtc}
        AND "startAt" < ${toUtc}
      ORDER BY "startAt" ASC
    `);
    expect(apptPlan.map((r) => r['QUERY PLAN']).join('\n')).toMatch(
      /Index Scan|Bitmap Index Scan|Index Only Scan/i,
    );

    const clientPlan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN SELECT * FROM "Client"
      WHERE "companyId" = ${company.id}::uuid
        AND "phone" = ${oneClient.phone}
    `);
    expect(clientPlan.map((r) => r['QUERY PLAN']).join('\n')).toMatch(
      /Index Scan|Bitmap Index Scan|Index Only Scan/i,
    );

    const outboxPlan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN SELECT * FROM "OutboxMessage"
      WHERE "status" = 'PENDING'::"OutboxStatus"
        AND "scheduledFor" <= ${toUtc}
      ORDER BY "scheduledFor" ASC
      LIMIT 50
    `);
    expect(outboxPlan.map((r) => r['QUERY PLAN']).join('\n')).toMatch(
      /Index Scan|Bitmap Index Scan|Index Only Scan/i,
    );
  });

  it('handles 200 parallel booking requests across 20 slots with zero double-bookings and zero deadlocks', async () => {
    const company = await createCompanyFactory({
      slug: `load-${randomUUID().slice(0, 6)}`,
      publicBookingEnabled: true,
      minLeadTimeMin: 0,
      maxAdvanceDays: 30,
    });
    const plan = await prisma.plan.create({
      data: {
        code: `load-plan-${randomUUID().slice(0, 6)}`,
        name: 'Load Plan',
        priceMonthly: 2000,
        maxStaff: 10,
        featureAnalytics: true,
        featureAutoReminders: true,
        featurePrepayment: true,
        isPublic: false,
        isActive: true,
      },
    });
    await prisma.subscription.create({
      data: {
        companyId: company.id,
        planId: plan.id,
        isTrial: false,
        periodStartsAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate(),
        periodEndsAt: DateTime.fromISO('2026-12-31T00:00:00.000Z').toJSDate(),
      },
    });
    const master = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id, { durationMin: 30 });
    await prisma.masterService.create({
      data: { userId: master.id, serviceId: service.id },
    });
    // Day 2 = Tuesday (2026-11-17 is Tuesday)
    await prisma.workingHours.create({
      data: {
        userId: master.id,
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '20:00',
      },
    });

    // 20 distinct 30-min slots on 2026-11-17 Asia/Bishkek (09:00..18:30 local = 03:00..12:30 UTC)
    const slots = Array.from({ length: 20 }, (_, i) =>
      DateTime.fromISO('2026-11-17T03:00:00.000Z')
        .plus({ minutes: i * 30 })
        .toISO(),
    );

    app.set('trust proxy', 1);
    const requests = Array.from({ length: 200 }, (_, i) => {
      const slot = slots[i % 20] ?? '';
      return request(app)
        .post(`/api/v1/public/companies/${company.slug}/appointments`)
        .set('X-Forwarded-For', `10.10.${Math.floor(i / 250)}.${(i % 250) + 1}`)
        .send({
          serviceId: service.id,
          masterId: master.id,
          startAt: slot,
          clientName: `Load Client ${i}`,
          clientPhone: `+996555${String(200000 + i).slice(-6)}`,
          consentAccepted: true,
        });
    });

    const responses = await Promise.all(requests);
    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);
    const serverErrors = responses.filter((r) => r.status >= 500);

    expect(serverErrors).toHaveLength(0);
    expect(
      created.length,
      `Sample status=${responses[0]?.status} body=${JSON.stringify(responses[0]?.body)}`,
    ).toBe(20);
    expect(conflicts.length).toBe(180);

    const dbCount = await prisma.appointment.count({ where: { companyId: company.id } });
    expect(dbCount).toBe(20);
  }, 30_000);
});
