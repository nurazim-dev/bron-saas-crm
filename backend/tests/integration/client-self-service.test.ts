import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { disconnectPrisma, prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { truncateAllTables } from '../helpers/db.js';
import { createServiceFactory } from '../helpers/factories.js';

const app = createApp();

interface DataEnvelope<T> {
  data: T;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Array<{ reason?: string }> };
}

function asBody<T>(body: unknown): T {
  return body as T;
}

async function setupShop() {
  const regRes = await request(app)
    .post('/api/v1/auth/register')
    .send({
      companyName: 'Self Service Barber',
      slug: `ss-${Date.now()}`,
      businessType: 'BARBERSHOP',
      ownerName: 'Owner SS',
      email: `owner-${Date.now()}@test.kg`,
      password: 'Password123',
      termsAccepted: true,
      phone: '+996555000001',
    });
  expect(regRes.status).toBe(201);
  const auth = asBody<
    DataEnvelope<{
      accessToken: string;
      company: { id: string; slug: string };
      user: { id: string };
    }>
  >(regRes.body).data;

  const svc = await createServiceFactory(auth.company.id, {
    name: 'Haircut 60',
    durationMin: 60,
    price: '700.00',
  });

  const masterRes = await request(app)
    .post('/api/v1/staff')
    .set('Authorization', `Bearer ${auth.accessToken}`)
    .send({
      name: 'Master SS',
      email: `master-${Date.now()}@test.kg`,
      password: 'Password123',
      isBookable: true,
    });
  const masterId = asBody<DataEnvelope<{ id: string }>>(masterRes.body).data.id;

  await prisma.masterService.create({ data: { userId: masterId, serviceId: svc.id } });
  await request(app)
    .put(`/api/v1/staff/${masterId}/working-hours`)
    .set('Authorization', `Bearer ${auth.accessToken}`)
    .send({ days: [{ dayOfWeek: 4, startTime: '09:00', endTime: '18:00' }] });

  return { auth, svc, masterId };
}

describe('Client Self-Service (Phase 19 / BR-16)', () => {
  beforeAll(() => {
    setClock(new FakeClock(new Date('2026-11-18T03:00:00.000Z')));
  });

  afterAll(async () => {
    resetClock();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    resetRateLimitersForTest();
    setClock(new FakeClock(new Date('2026-11-18T03:00:00.000Z')));
    await truncateAllTables();
  });

  it('returns manageUrl on booking, prevents token oracle, hides foreign PII, and handles reschedule onto own slot & limits', async () => {
    const { auth, svc, masterId } = await setupShop();

    // Unknown token -> 404
    const unknownRes = await request(app).get('/api/v1/public/manage/nonexistent-token-12345678');
    expect(unknownRes.status).toBe(404);

    // Book 10:00 local (04:00 UTC on 2026-11-19)
    const bookRes = await request(app)
      .post(`/api/v1/public/companies/${auth.company.slug}/appointments`)
      .send({
        serviceId: svc.id,
        masterId,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'Азамат',
        clientPhone: '+996555112233',
        consentAccepted: true,
      });
    expect(bookRes.status).toBe(201);
    const { manageUrl } = asBody<DataEnvelope<{ manageUrl: string }>>(bookRes.body).data;
    const token = manageUrl.split('/manage/')[1] ?? '';
    expect(token.length).toBeGreaterThanOrEqual(32);

    // GET /public/manage/:token must NOT expose clientPhone
    const getRes = await request(app).get(`/api/v1/public/manage/${token}`);
    expect(getRes.status).toBe(200);
    expect(JSON.stringify(getRes.body)).not.toContain('+996555112233');
    const manageDto = asBody<
      DataEnvelope<{
        id: string;
        rescheduledCount: number;
        actions: { canCancel: boolean; canReschedule: boolean };
      }>
    >(getRes.body).data;
    expect(manageDto.actions.canCancel).toBe(true);
    expect(manageDto.actions.canReschedule).toBe(true);

    // Reschedule #1 onto 10:30 local (04:30 UTC) — overlaps own old 10:00-11:00 slot!
    const resch1 = await request(app)
      .post(`/api/v1/public/manage/${token}/reschedule`)
      .send({ startAt: '2026-11-19T04:30:00.000Z' });
    expect(resch1.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ rescheduledCount: number }>>(resch1.body).data.rescheduledCount,
    ).toBe(1);

    // Reschedule #2 onto 12:00 local (06:00 UTC)
    const resch2 = await request(app)
      .post(`/api/v1/public/manage/${token}/reschedule`)
      .send({ startAt: '2026-11-19T06:00:00.000Z' });
    expect(resch2.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ rescheduledCount: number }>>(resch2.body).data.rescheduledCount,
    ).toBe(2);

    // Reschedule #3 -> 422 CHANGE_NOT_ALLOWED (RESCHEDULE_LIMIT)
    const resch3 = await request(app)
      .post(`/api/v1/public/manage/${token}/reschedule`)
      .send({ startAt: '2026-11-19T07:00:00.000Z' });
    expect(resch3.status).toBe(422);
    const err3 = asBody<ErrorEnvelope>(resch3.body).error;
    expect(err3.code).toBe('CHANGE_NOT_ALLOWED');
    expect(err3.details?.[0]?.reason).toBe('RESCHEDULE_LIMIT');

    // Verify staff received in-app & outbox email notifications for reschedules
    const inAppCount = await prisma.inAppNotification.count({
      where: { companyId: auth.company.id, kind: 'CLIENT_RESCHEDULED' },
    });
    expect(inAppCount).toBeGreaterThanOrEqual(2);
  });

  it('enforces window boundaries via FakeClock, concurrent reschedule race, and allows cancel when LOCKED', async () => {
    const { auth, svc, masterId } = await setupShop();

    const book1 = await request(app)
      .post(`/api/v1/public/companies/${auth.company.slug}/appointments`)
      .send({
        serviceId: svc.id,
        masterId,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'Client One',
        clientPhone: '+996555111001',
        consentAccepted: true,
      });
    const book2 = await request(app)
      .post(`/api/v1/public/companies/${auth.company.slug}/appointments`)
      .send({
        serviceId: svc.id,
        masterId,
        startAt: '2026-11-19T06:00:00.000Z',
        clientName: 'Client Two',
        clientPhone: '+996555111002',
        consentAccepted: true,
      });

    const token1 =
      asBody<DataEnvelope<{ manageUrl: string }>>(book1.body).data.manageUrl.split('/manage/')[1] ??
      '';
    const token2 =
      asBody<DataEnvelope<{ manageUrl: string }>>(book2.body).data.manageUrl.split('/manage/')[1] ??
      '';

    // Concurrent race: both try to reschedule to 08:00 UTC -> one 200, one 409
    const [race1, race2] = await Promise.all([
      request(app)
        .post(`/api/v1/public/manage/${token1}/reschedule`)
        .send({ startAt: '2026-11-19T08:00:00.000Z' }),
      request(app)
        .post(`/api/v1/public/manage/${token2}/reschedule`)
        .send({ startAt: '2026-11-19T08:00:00.000Z' }),
    ]);
    const statuses = [race1.status, race2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loserToken = race1.status === 409 ? token1 : token2;
    const loserStartAt =
      race1.status === 409 ? '2026-11-19T04:00:00.000Z' : '2026-11-19T06:00:00.000Z';

    // Window boundary: clientCancelMinHours = 2. Move clock to 1h59m before loserStartAt -> WINDOW_CLOSED
    const loserMs = new Date(loserStartAt).getTime();
    setClock(new FakeClock(new Date(loserMs - (2 * 60 - 1) * 60_000)));
    const closedCancel = await request(app)
      .post(`/api/v1/public/manage/${loserToken}/cancel`)
      .send({});
    expect(closedCancel.status).toBe(422);
    expect(asBody<ErrorEnvelope>(closedCancel.body).error.details?.[0]?.reason).toBe(
      'WINDOW_CLOSED',
    );

    // Move clock back to 2h00m before loserStartAt AND lock company billing -> cancel STILL works!
    setClock(new FakeClock(new Date(loserMs - 2 * 60 * 60_000)));
    await prisma.subscription.updateMany({
      where: { companyId: auth.company.id },
      data: {
        status: 'LOCKED',
        periodStartsAt: new Date('2026-11-01T00:00:00.000Z'),
        periodEndsAt: new Date('2026-11-10T00:00:00.000Z'),
      },
    });

    const lockedCancel = await request(app)
      .post(`/api/v1/public/manage/${loserToken}/cancel`)
      .send({ reason: 'Планы изменились' });
    expect(lockedCancel.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ status: string; cancelledBy: string }>>(lockedCancel.body).data,
    ).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'CLIENT',
    });

    // Repeat cancel -> 422 NOT_SCHEDULED
    const repeatCancel = await request(app)
      .post(`/api/v1/public/manage/${loserToken}/cancel`)
      .send({});
    expect(repeatCancel.status).toBe(422);
    expect(asBody<ErrorEnvelope>(repeatCancel.body).error.details?.[0]?.reason).toBe(
      'NOT_SCHEDULED',
    );
  });

  it('enforces write rate limit on manage cancel/reschedule', async () => {
    const { auth, svc, masterId } = await setupShop();
    const bookRes = await request(app)
      .post(`/api/v1/public/companies/${auth.company.slug}/appointments`)
      .send({
        serviceId: svc.id,
        masterId,
        startAt: '2026-11-19T04:00:00.000Z',
        clientName: 'Rate Client',
        clientPhone: '+996555111999',
        consentAccepted: true,
      });
    const token =
      asBody<DataEnvelope<{ manageUrl: string }>>(bookRes.body).data.manageUrl.split(
        '/manage/',
      )[1] ?? '';

    for (let i = 0; i < 10; i++) {
      await request(app).post(`/api/v1/public/manage/${token}/cancel`).send({});
    }
    const limited = await request(app).post(`/api/v1/public/manage/${token}/cancel`).send({});
    expect(limited.status).toBe(429);
    expect(asBody<ErrorEnvelope>(limited.body).error.code).toBe('RATE_LIMITED');
  });
});
