import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { localAllDayRangeToUtc } from '../../src/lib/datetime.js';
import { disconnectPrisma, prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { truncateAllTables } from '../helpers/db.js';
import { createServiceFactory } from '../helpers/factories.js';

const app = createApp();

interface DataEnvelope<T, M = unknown> {
  data: T;
  meta?: M;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

function asBody<T>(body: unknown): T {
  return body as T;
}

async function registerOwner(opts: { email: string; slug: string }) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      companyName: `Company ${opts.slug}`,
      slug: opts.slug,
      businessType: 'BARBERSHOP',
      ownerName: 'Owner Test',
      email: opts.email,
      password: 'Password123',
      phone: '+996555000001',
    });
  expect(res.status).toBe(201);
  return asBody<
    DataEnvelope<{
      accessToken: string;
      company: { id: string; slug: string };
      user: { id: string };
    }>
  >(res.body).data;
}

describe('Breaks & Time Off (Phase 18 / BR-15)', () => {
  beforeAll(() => {
    setClock(new FakeClock(new Date('2026-11-18T03:00:00.000Z')));
  });

  afterAll(async () => {
    resetClock();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  it('computes DST-safe localAllDayRangeToUtc across spring-forward, fall-back, and Asia/Bishkek', () => {
    const spring = localAllDayRangeToUtc('2026-03-08', '2026-03-08', 'America/New_York');
    expect((spring.endAt.getTime() - spring.startAt.getTime()) / 3_600_000).toBe(23);

    const fall = localAllDayRangeToUtc('2026-11-01', '2026-11-01', 'America/New_York');
    expect((fall.endAt.getTime() - fall.startAt.getTime()) / 3_600_000).toBe(25);

    const bishkek = localAllDayRangeToUtc('2026-11-19', '2026-11-21', 'Asia/Bishkek');
    expect(bishkek.startAt.toISOString()).toBe('2026-11-18T18:00:00.000Z');
    expect(bishkek.endAt.toISOString()).toBe('2026-11-21T18:00:00.000Z');
  });

  it('validates breaks, subtracts break & time-off from availability, rejects public 422, and falls back in any-master', async () => {
    const owner = await registerOwner({ email: 'p18-owner@test.kg', slug: 'p18-shop' });
    const svc = await createServiceFactory(owner.company.id, {
      name: 'Haircut 60',
      durationMin: 60,
      price: '700.00',
    });

    const m1Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master One',
        email: 'm1-p18@test.kg',
        password: 'Password123',
        isBookable: true,
      });
    const m1Id = asBody<DataEnvelope<{ id: string }>>(m1Res.body).data.id;

    const m2Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master Two',
        email: 'm2-p18@test.kg',
        password: 'Password123',
        isBookable: true,
      });
    const m2Id = asBody<DataEnvelope<{ id: string }>>(m2Res.body).data.id;

    await prisma.masterService.createMany({
      data: [
        { userId: m1Id, serviceId: svc.id },
        { userId: m2Id, serviceId: svc.id },
      ],
    });

    // Invalid break (outside working hours) -> 400
    const badBreak = await request(app)
      .put(`/api/v1/staff/${m1Id}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        days: [
          {
            dayOfWeek: 4,
            startTime: '09:00',
            endTime: '18:00',
            breakStart: '08:00',
            breakEnd: '09:30',
          },
        ],
      });
    expect(badBreak.status).toBe(400);

    // Set working hours for Thursday (dayOfWeek 4) with 13:00-14:00 lunch break for Master 1
    const wh1 = await request(app)
      .put(`/api/v1/staff/${m1Id}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        days: [
          {
            dayOfWeek: 4,
            startTime: '09:00',
            endTime: '18:00',
            breakStart: '13:00',
            breakEnd: '14:00',
          },
        ],
      });
    expect(wh1.status).toBe(200);

    // Master 2 works Thursday 09:00-18:00 without break
    await request(app)
      .put(`/api/v1/staff/${m2Id}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        days: [{ dayOfWeek: 4, startTime: '09:00', endTime: '18:00' }],
      });

    // Check Master 1 availability on 2026-11-19 (Thursday): 12:30 (overlaps 13:00-14:00) & 13:00 & 13:30 must be absent!
    const avail1 = await request(app).get(
      `/api/v1/public/companies/${owner.company.slug}/availability?serviceId=${svc.id}&masterId=${m1Id}&date=2026-11-19`,
    );
    expect(avail1.status).toBe(200);
    const labels1 = asBody<DataEnvelope<{ slots: Array<{ label: string }> }>>(
      avail1.body,
    ).data.slots.map((s) => s.label);
    expect(labels1).toContain('12:00');
    expect(labels1).not.toContain('12:30');
    expect(labels1).not.toContain('13:00');
    expect(labels1).not.toContain('13:30');
    expect(labels1).toContain('14:00');

    // Public booking for Master 1 at 13:00 local (07:00 UTC) -> 422 SLOT_NOT_AVAILABLE
    const bookBreak = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        serviceId: svc.id,
        masterId: m1Id,
        startAt: '2026-11-19T07:00:00.000Z',
        clientName: 'Client Test',
        clientPhone: '+996555223344',
        consentAccepted: true,
      });
    expect(bookBreak.status).toBe(422);
    expect(asBody<ErrorEnvelope>(bookBreak.body).error.code).toBe('SLOT_NOT_AVAILABLE');

    // Put Master 1 on 3-day vacation (2026-11-19..2026-11-21); any-master at 13:00 local MUST pick Master 2!
    const vacRes = await request(app)
      .post('/api/v1/time-off')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        userId: m1Id,
        kind: 'VACATION',
        allDay: true,
        startDate: '2026-11-19',
        endDate: '2026-11-21',
        note: 'Family trip',
      });
    expect(vacRes.status).toBe(201);

    const anyMasterBook = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        serviceId: svc.id,
        masterId: 'ANY',
        startAt: '2026-11-19T07:00:00.000Z',
        clientName: 'Any Master Client',
        clientPhone: '+996555334455',
        consentAccepted: true,
      });
    expect(anyMasterBook.status).toBe(201);
    expect(
      asBody<DataEnvelope<{ appointment: { master: { id: string } } }>>(anyMasterBook.body).data
        .appointment.master.id,
    ).toBe(m2Id);
  });

  it('reports conflicts on TimeOff creation, enforces MASTER permissions, and returns warnings on staff override', async () => {
    const owner = await registerOwner({ email: 'p18b-owner@test.kg', slug: 'p18b-shop' });
    const otherOwner = await registerOwner({ email: 'p18c-owner@test.kg', slug: 'p18c-shop' });

    const svc = await createServiceFactory(owner.company.id, {
      name: 'Beard 30',
      durationMin: 30,
      price: '400.00',
    });

    const m1Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master One',
        email: 'm1-p18b@test.kg',
        password: 'Password123',
        isBookable: true,
      });
    const m1Id = asBody<DataEnvelope<{ id: string }>>(m1Res.body).data.id;

    const m2Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master Two',
        email: 'm2-p18b@test.kg',
        password: 'Password123',
        isBookable: true,
      });
    const m2Id = asBody<DataEnvelope<{ id: string }>>(m2Res.body).data.id;

    await prisma.masterService.create({ data: { userId: m1Id, serviceId: svc.id } });

    await request(app)
      .put(`/api/v1/staff/${m1Id}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        days: [
          {
            dayOfWeek: 4,
            startTime: '09:00',
            endTime: '18:00',
            breakStart: '13:00',
            breakEnd: '14:00',
          },
        ],
      });

    // Staff books during break (13:00 local = 07:00 UTC) -> succeeds with DURING_BREAK warning!
    const overrideBreak = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        masterId: m1Id,
        serviceId: svc.id,
        startAt: '2026-11-19T07:00:00.000Z',
        clientName: 'Walk-in Client',
        clientPhone: '+996555667788',
      });
    expect(overrideBreak.status).toBe(201);
    const apptBody = asBody<DataEnvelope<{ id: string; warnings: string[] }>>(
      overrideBreak.body,
    ).data;
    expect(apptBody.warnings).toContain('DURING_BREAK');

    // Create TimeOff overlapping that appointment -> reports conflict count 1, appointment stays untouched!
    const m1Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'm1-p18b@test.kg', password: 'Password123' });
    const m1Token = asBody<DataEnvelope<{ accessToken: string }>>(m1Login.body).data.accessToken;

    const m1TimeOff = await request(app)
      .post('/api/v1/time-off')
      .set('Authorization', `Bearer ${m1Token}`)
      .send({
        kind: 'SICK_LEAVE',
        allDay: true,
        startDate: '2026-11-19',
        endDate: '2026-11-19',
      });
    expect(m1TimeOff.status).toBe(201);
    const toEnvelope = asBody<
      DataEnvelope<{ id: string }, { conflicts: { count: number; appointmentIds: string[] } }>
    >(m1TimeOff.body);
    expect(toEnvelope.meta?.conflicts.count).toBe(1);
    expect(toEnvelope.meta?.conflicts.appointmentIds).toContain(apptBody.id);

    // Master 1 cannot create/list/delete Master 2's time off (404)
    const m1ForM2 = await request(app)
      .post('/api/v1/time-off')
      .set('Authorization', `Bearer ${m1Token}`)
      .send({
        userId: m2Id,
        kind: 'VACATION',
        allDay: true,
        startDate: '2026-11-20',
        endDate: '2026-11-20',
      });
    expect(m1ForM2.status).toBe(404);

    // Cross-tenant 404
    const crossTenantDel = await request(app)
      .delete(`/api/v1/time-off/${toEnvelope.data.id}`)
      .set('Authorization', `Bearer ${otherOwner.accessToken}`);
    expect(crossTenantDel.status).toBe(404);

    // Staff books another slot during TimeOff (15:00 local = 09:00 UTC) -> succeeds with DURING_TIME_OFF warning
    const overrideTimeOff = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        masterId: m1Id,
        serviceId: svc.id,
        startAt: '2026-11-19T09:00:00.000Z',
        clientName: 'Urgent Client',
        clientPhone: '+996555998877',
      });
    expect(overrideTimeOff.status).toBe(201);
    expect(
      asBody<DataEnvelope<{ warnings: string[] }>>(overrideTimeOff.body).data.warnings,
    ).toContain('DURING_TIME_OFF');
  });
});
