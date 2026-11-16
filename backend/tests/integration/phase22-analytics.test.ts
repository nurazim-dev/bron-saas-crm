import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  AppointmentSource,
  AppointmentStatus,
  Prisma,
  Role,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { prisma } from '../../src/lib/prisma.js';
import { escapeCsvCell } from '../../src/modules/analytics/analytics.service.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

interface DataEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

function asBody<T>(body: unknown): T {
  return body as T;
}

async function createSub(
  companyId: string,
  options: { featureAnalytics?: boolean; periodEndsAt?: Date } = {},
) {
  const plan = await prisma.plan.create({
    data: {
      code: `p22-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Analytics Test Plan',
      priceMonthly: 2000,
      maxStaff: 10,
      featureAnalytics: options.featureAnalytics ?? true,
      featureAutoReminders: true,
      featurePrepayment: true,
      isPublic: false,
      isActive: true,
    },
  });
  await prisma.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      isTrial: false,
      periodStartsAt: DateTime.fromISO('2026-10-01T00:00:00.000Z').toJSDate(),
      periodEndsAt: options.periodEndsAt ?? DateTime.fromISO('2026-12-01T00:00:00.000Z').toJSDate(),
      status: 'ACTIVE',
    },
  });
}

describe('Phase 22: Analytics & CSV Export', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p22-plan-' } } });
  });

  afterEach(async () => {
    resetClock();
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p22-plan-' } } });
  });

  it('computes summary, timeseries, services, heatmap, and decimal sums accurately across UTC boundaries and DST', async () => {
    setClock(new FakeClock('2026-11-20T12:00:00.000Z'));

    // America/New_York (UTC-5 after 2026-11-01 DST fall-back): 21:00 NY on Nov 16 = 02:00 UTC on Nov 17
    const company = await createCompanyFactory({ timezone: 'America/New_York' });
    await createSub(company.id, { featureAnalytics: true });

    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id, {
      name: 'Coloring',
      durationMin: 60,
      price: new Prisma.Decimal('100.10'),
    });

    // Returning client: 1 prior appointment on Nov 10
    await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      clientName: 'Client Return',
      clientPhone: '+996555111000',
      startAt: DateTime.fromISO('2026-11-10T15:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-10T16:00:00.000Z').toJSDate(),
      price: new Prisma.Decimal('50.00'),
      status: AppointmentStatus.COMPLETED,
    });

    // Nov 16 21:00 NY (= Nov 17 02:00 UTC) -> MUST belong to 2026-11-16 bucket!
    await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      clientName: 'Client Return',
      clientPhone: '+996555111000',
      startAt: DateTime.fromISO('2026-11-17T02:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-17T03:00:00.000Z').toJSDate(),
      price: new Prisma.Decimal('100.10'),
      status: AppointmentStatus.COMPLETED,
      source: AppointmentSource.ONLINE,
    });

    // Nov 16 14:00 NY (= Nov 16 19:00 UTC) -> new client, COMPLETED, 200.20
    await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      clientName: 'Client New',
      clientPhone: '+996555222000',
      startAt: DateTime.fromISO('2026-11-16T19:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-16T20:00:00.000Z').toJSDate(),
      price: new Prisma.Decimal('200.20'),
      status: AppointmentStatus.COMPLETED,
      source: AppointmentSource.STAFF,
    });

    // Nov 16 16:00 NY -> NO_SHOW
    await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      clientName: 'Client NoShow',
      clientPhone: '+996555333000',
      startAt: DateTime.fromISO('2026-11-16T21:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-16T22:00:00.000Z').toJSDate(),
      price: new Prisma.Decimal('100.00'),
      status: AppointmentStatus.NO_SHOW,
    });

    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    const sumRes = await request(app)
      .get('/api/v1/analytics/summary?from=2026-11-16&to=2026-11-16')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(sumRes.status).toBe(200);
    const sum = asBody<
      DataEnvelope<{
        revenue: string;
        averageTicket: string;
        noShowRate: number;
        counts: { total: number; completed: number; noShow: number };
        clients: { newCount: number; returningCount: number };
        sources: { online: number; staff: number };
      }>
    >(sumRes.body).data;

    expect(sum.revenue).toBe('300.30');
    expect(sum.averageTicket).toBe('150.15');
    expect(sum.counts.total).toBe(3);
    expect(sum.counts.completed).toBe(2);
    expect(sum.counts.noShow).toBe(1);
    expect(sum.noShowRate).toBe(33.3);
    expect(sum.clients.returningCount).toBe(1);
    expect(sum.clients.newCount).toBe(2);
    expect(sum.sources.online).toBe(2); // factory default ONLINE + explicit ONLINE
    expect(sum.sources.staff).toBe(1);

    const tsRes = await request(app)
      .get('/api/v1/analytics/timeseries?from=2026-11-16&to=2026-11-16&granularity=day')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(tsRes.status).toBe(200);
    const points = asBody<
      DataEnvelope<{ points: Array<{ date: string; revenue: string; total: number }> }>
    >(tsRes.body).data.points;
    expect(points).toHaveLength(1);
    expect(points[0]?.date).toBe('2026-11-16');
    expect(points[0]?.revenue).toBe('300.30');
    expect(points[0]?.total).toBe(3);

    const heatRes = await request(app)
      .get('/api/v1/analytics/heatmap?from=2026-11-16&to=2026-11-16')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(heatRes.status).toBe(200);
    const heat = asBody<DataEnvelope<Array<{ weekday: number; hour: number; count: number }>>>(
      heatRes.body,
    ).data;
    expect(heat.some((h) => h.weekday === 1 && h.hour === 21 && h.count === 1)).toBe(true);
  });

  it('computes master utilization subtracting breaks and time off', async () => {
    setClock(new FakeClock('2026-11-20T12:00:00.000Z'));

    const company = await createCompanyFactory({ timezone: 'Asia/Bishkek' });
    await createSub(company.id, { featureAnalytics: true });
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id, { durationMin: 60 });

    // Monday 2026-11-16: 09:00-13:00 (240m) minus break 11:00-12:00 (60m) = 180m
    // TimeOff 12:00-13:00 (60m) -> 120m available
    await prisma.workingHours.create({
      data: {
        userId: owner.id,
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '13:00',
        breakStart: '11:00',
        breakEnd: '12:00',
      },
    });
    await prisma.timeOff.create({
      data: {
        companyId: company.id,
        userId: owner.id,
        startAt: DateTime.fromISO('2026-11-16T06:00:00.000Z').toJSDate(), // 12:00 Bishkek
        endAt: DateTime.fromISO('2026-11-16T07:00:00.000Z').toJSDate(), // 13:00 Bishkek
        kind: 'OTHER',
      },
    });
    // 60m appointment 09:00-10:00 Bishkek (03:00-04:00 UTC) -> 60 / 120 = 50%
    await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      startAt: DateTime.fromISO('2026-11-16T03:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-16T04:00:00.000Z').toJSDate(),
      status: AppointmentStatus.COMPLETED,
    });

    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    const res = await request(app)
      .get('/api/v1/analytics/masters?from=2026-11-16&to=2026-11-16')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const masters = asBody<
      DataEnvelope<
        Array<{ availableMinutes: number; bookedMinutes: number; utilizationPct: number }>
      >
    >(res.body).data;
    expect(masters).toHaveLength(1);
    expect(masters[0]?.availableMinutes).toBe(120);
    expect(masters[0]?.bookedMinutes).toBe(60);
    expect(masters[0]?.utilizationPct).toBe(50);
  });

  it('enforces plan gate, MASTER scoping, CSV formula escaping, and LOCKED export allowance', async () => {
    setClock(new FakeClock('2026-11-20T12:00:00.000Z'));

    // Active subscription with featureAnalytics=false
    const company = await createCompanyFactory({ timezone: 'Asia/Bishkek' });
    await createSub(company.id, {
      featureAnalytics: false,
      periodEndsAt: DateTime.fromISO('2026-12-01T00:00:00.000Z').toJSDate(),
    });
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: false });
    const master = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    const service = await createServiceFactory(company.id, { durationMin: 60 });

    await createAppointmentFactory({
      companyId: company.id,
      masterId: master.id,
      serviceId: service.id,
      clientName: '=CMD("calc")',
      clientPhone: '+996555111222',
      startAt: DateTime.fromISO('2026-11-16T04:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-16T05:00:00.000Z').toJSDate(),
      status: AppointmentStatus.COMPLETED,
    });

    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });
    const masterToken = signAccessToken({
      sub: master.id,
      companyId: company.id,
      role: Role.MASTER,
      tv: master.tokenVersion,
    });

    // OWNER without featureAnalytics -> 402 FEATURE_NOT_IN_PLAN
    const gatedRes = await request(app)
      .get('/api/v1/analytics/summary?from=2026-11-16&to=2026-11-16')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(gatedRes.status).toBe(402);
    expect(asBody<ErrorEnvelope>(gatedRes.body).error.code).toBe('FEATURE_NOT_IN_PLAN');

    // MASTER on OWNER analytics -> 403 FORBIDDEN
    const masterForbidden = await request(app)
      .get('/api/v1/analytics/summary?from=2026-11-16&to=2026-11-16')
      .set('Authorization', `Bearer ${masterToken}`);
    expect(masterForbidden.status).toBe(403);

    // MASTER on /me/summary -> 200 (ungated)
    const masterMe = await request(app)
      .get('/api/v1/analytics/me/summary?from=2026-11-16&to=2026-11-16')
      .set('Authorization', `Bearer ${masterToken}`);
    expect(masterMe.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ counts: { completed: number } }>>(masterMe.body).data.counts.completed,
    ).toBe(1);

    // Expire subscription -> LOCKED, CSV export still works and escapes formula injection
    await prisma.subscription.update({
      where: { companyId: company.id },
      data: { periodEndsAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate() },
    });

    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");

    const csvRes = await request(app)
      .get('/api/v1/export/appointments.csv?from=2026-11-16&to=2026-11-16')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.text).toContain('\'=CMD(""calc"")');
  });

  it('uses Appointment index in EXPLAIN on a ~5k-appointment dataset', async () => {
    const company = await createCompanyFactory();
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id);
    const client = await prisma.client.create({
      data: { companyId: company.id, name: 'Bulk Client', phone: '+996555000999' },
    });

    const baseMs = DateTime.fromISO('2026-10-01T00:00:00.000Z').toMillis();
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      clientId: client.id,
      clientName: 'Bulk Client',
      clientPhone: '+996555000999',
      startAt: DateTime.fromMillis(baseMs + i * 600_000).toJSDate(),
      endAt: DateTime.fromMillis(baseMs + i * 600_000 + 300_000).toJSDate(),
      price: new Prisma.Decimal('500.00'),
      status: AppointmentStatus.COMPLETED,
      source: AppointmentSource.ONLINE,
      manageToken: `bulk-tok-${i}-${Math.random().toString(36).slice(2, 8)}`,
    }));
    await prisma.appointment.createMany({ data: rows });

    const fromUtc = DateTime.fromISO('2026-10-15T00:00:00.000Z').toJSDate();
    const toUtc = DateTime.fromISO('2026-10-20T00:00:00.000Z').toJSDate();
    const planRows = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>(Prisma.sql`
      EXPLAIN SELECT COUNT(*), SUM("price")
      FROM "Appointment"
      WHERE "companyId" = ${company.id}::uuid
        AND "deletedAt" IS NULL
        AND "startAt" >= ${fromUtc}
        AND "startAt" < ${toUtc}
    `);
    const planText = planRows.map((r) => r['QUERY PLAN']).join('\n');
    expect(planText).toMatch(/Index Scan|Bitmap Index Scan|Index Only Scan/i);
  });
});
