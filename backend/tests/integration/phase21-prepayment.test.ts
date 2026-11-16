import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  AppointmentStatus,
  PrepaymentMode,
  PrepaymentStatus,
  Prisma,
  ReminderMode,
  Role,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { prisma } from '../../src/lib/prisma.js';
import { computePrepaymentAmount } from '../../src/modules/appointments/prepayment.js';
import { runPrepaymentExpiryOnce } from '../../src/worker/jobs/prepayment-expiry.job.js';
import { truncateAllTables } from '../helpers/db.js';
import {
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

async function seedScheduleAndServiceLink(userId: string, serviceId: string) {
  await prisma.workingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      userId,
      dayOfWeek,
      startTime: '09:00',
      endTime: '18:00',
    })),
  });
  await prisma.masterService.create({ data: { userId, serviceId } });
}

async function createSub(companyId: string, featurePrepayment: boolean) {
  const plan = await prisma.plan.create({
    data: {
      code: `p21-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Business Test',
      priceMonthly: 2000,
      maxStaff: 10,
      featureAnalytics: true,
      featureAutoReminders: true,
      featurePrepayment,
      isPublic: false,
      isActive: true,
    },
  });
  await prisma.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      isTrial: false,
      periodStartsAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate(),
      periodEndsAt: DateTime.fromISO('2026-12-01T00:00:00.000Z').toJSDate(),
      status: 'ACTIVE',
    },
  });
}

describe('Phase 21: Light Prepayment (BR-18)', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p21-plan-' } } });
  });

  afterEach(async () => {
    resetClock();
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p21-plan-' } } });
  });

  it('computes FIXED and PERCENT amounts with rounding and price cap', () => {
    expect(computePrepaymentAmount(1500, PrepaymentMode.FIXED, 500).toFixed(2)).toBe('500.00');
    expect(computePrepaymentAmount(400, PrepaymentMode.FIXED, 500).toFixed(2)).toBe('400.00');
    expect(computePrepaymentAmount(1255, PrepaymentMode.PERCENT, 30).toFixed(2)).toBe('377.00');
    expect(computePrepaymentAmount(1000, PrepaymentMode.PERCENT, 100).toFixed(2)).toBe('1000.00');
  });

  it('enforces plan gate and paymentInstructions requirement on service creation', async () => {
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory({ paymentInstructions: null });
    await createSub(company.id, false);
    const owner = await createUserFactory(company.id, { role: Role.OWNER });
    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    // 1. Plan lacks featurePrepayment -> 402 FEATURE_NOT_IN_PLAN
    const noPlanRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Премиум стрижка',
        durationMin: 60,
        price: '1000.00',
        requiresPrepayment: true,
        prepaymentMode: 'PERCENT',
        prepaymentValue: '30',
      });
    expect(noPlanRes.status).toBe(402);
    expect(asBody<ErrorEnvelope>(noPlanRes.body).error.code).toBe('FEATURE_NOT_IN_PLAN');

    // 2. Plan has featurePrepayment, but paymentInstructions missing -> 409 PAYMENT_INSTRUCTIONS_REQUIRED
    await prisma.plan.updateMany({
      where: { code: { startsWith: 'p21-plan-' } },
      data: { featurePrepayment: true },
    });
    const noInstRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Премиум стрижка',
        durationMin: 60,
        price: '1000.00',
        requiresPrepayment: true,
        prepaymentMode: 'PERCENT',
        prepaymentValue: '30',
      });
    expect(noInstRes.status).toBe(409);
    expect(asBody<ErrorEnvelope>(noInstRes.body).error.code).toBe('PAYMENT_INSTRUCTIONS_REQUIRED');

    // 3. Set paymentInstructions -> succeeds
    await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ paymentInstructions: 'MBank +996 555 123 456', prepaymentHoldMin: 30 });

    const okRes = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Премиум стрижка',
        durationMin: 60,
        price: '1000.00',
        requiresPrepayment: true,
        prepaymentMode: 'PERCENT',
        prepaymentValue: '30',
      });
    expect(okRes.status).toBe(201);
  });

  it('blocks slot while PENDING, expires hold on time travel, frees slot, and prevents race double-outcome', async () => {
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory({
      slug: 'prepay-salon',
      phone: '+996555111222',
      paymentInstructions: 'MBank 0555 111 222',
      prepaymentHoldMin: 30,
      reminderMode: ReminderMode.AUTO,
    });
    await createSub(company.id, true);

    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const master = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    const service = await createServiceFactory(company.id, {
      durationMin: 60,
      price: new Prisma.Decimal('1000.00'),
      requiresPrepayment: true,
      prepaymentMode: PrepaymentMode.PERCENT,
      prepaymentValue: new Prisma.Decimal('30.00'),
    });
    await seedScheduleAndServiceLink(master.id, service.id);

    // 1. Public booking -> PENDING + 300.00 + holdUntil +06:30Z
    const book1 = await request(app)
      .post('/api/v1/public/companies/prepay-salon/appointments')
      .send({
        serviceId: service.id,
        masterId: master.id,
        startAt: '2026-11-21T06:00:00.000Z',
        clientName: 'Алия',
        clientPhone: '+996555333444',
        consentAccepted: true,
      });
    expect(book1.status).toBe(201);
    const b1Data = asBody<
      DataEnvelope<{
        manageUrl: string;
        appointment: { id: string };
        prepayment: {
          status: string;
          amount: string;
          holdUntil: string;
          whatsappProofUrl: string;
        } | null;
      }>
    >(book1.body).data;
    expect(b1Data.prepayment?.status).toBe('PENDING');
    expect(b1Data.prepayment?.amount).toBe('300.00');
    expect(b1Data.prepayment?.holdUntil).toBe('2026-11-20T06:30:00.000Z');
    expect(b1Data.prepayment?.whatsappProofUrl).toContain('https://wa.me/996555111222?text=');

    // Slot is blocked while PENDING
    const conflictBook = await request(app)
      .post('/api/v1/public/companies/prepay-salon/appointments')
      .send({
        serviceId: service.id,
        masterId: master.id,
        startAt: '2026-11-21T06:00:00.000Z',
        clientName: 'Бегимай',
        clientPhone: '+996555444555',
        consentAccepted: true,
      });
    expect(conflictBook.status).toBe(409);

    // 2. Time-travel past 06:30Z -> expiry job cancels & frees slot
    const expiryTime = DateTime.fromISO('2026-11-20T06:31:00.000Z').toJSDate();
    setClock(new FakeClock(expiryTime));
    const expired = await runPrepaymentExpiryOnce(prisma, expiryTime);
    expect(expired.expiredCount).toBe(1);

    const apptAfterExp = await prisma.appointment.findUnique({
      where: { id: b1Data.appointment.id },
    });
    expect(apptAfterExp?.status).toBe(AppointmentStatus.CANCELLED);
    expect(apptAfterExp?.cancelReason).toBe('PREPAYMENT_EXPIRED');

    // Slot is now free for a second booking!
    const book2 = await request(app)
      .post('/api/v1/public/companies/prepay-salon/appointments')
      .send({
        serviceId: service.id,
        masterId: master.id,
        startAt: '2026-11-21T06:00:00.000Z',
        clientName: 'Бегимай',
        clientPhone: '+996555444555',
        consentAccepted: true,
      });
    expect(book2.status).toBe(201);
    const id2 = asBody<DataEnvelope<{ appointment: { id: string } }>>(book2.body).data.appointment
      .id;

    // 3. Parallel race: staff RECEIVED vs expiry job
    const raceTime = DateTime.fromISO('2026-11-20T07:05:00.000Z').toJSDate();
    setClock(new FakeClock(raceTime));
    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    const [staffRes, expRes] = await Promise.all([
      request(app)
        .post(`/api/v1/appointments/${id2}/prepayment`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ action: 'RECEIVED' }),
      runPrepaymentExpiryOnce(prisma, raceTime),
    ]);

    const staffWon = staffRes.status === 200;
    const expWon = expRes.expiredCount === 1;
    expect(staffWon !== expWon).toBe(true); // Exactly one outcome wins!
  });

  it('enforces prepayment transition rules, permissions (MASTER cannot REFUND), and tenant isolation', async () => {
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory({
      slug: 'perm-salon',
      paymentInstructions: 'MBank 0555 000 111',
    });
    const otherCompany = await createCompanyFactory();
    await createSub(company.id, true);

    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: false });
    const master1 = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    const master2 = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    const otherOwner = await createUserFactory(otherCompany.id, { role: Role.OWNER });

    const service = await createServiceFactory(company.id, {
      durationMin: 60,
      price: new Prisma.Decimal('1000.00'),
      requiresPrepayment: true,
      prepaymentMode: PrepaymentMode.FIXED,
      prepaymentValue: new Prisma.Decimal('200.00'),
    });
    await seedScheduleAndServiceLink(master1.id, service.id);

    const book = await request(app).post('/api/v1/public/companies/perm-salon/appointments').send({
      serviceId: service.id,
      masterId: master1.id,
      startAt: '2026-11-21T06:00:00.000Z',
      clientName: 'Тимур',
      clientPhone: '+996555222111',
      consentAccepted: true,
    });
    expect(book.status).toBe(201);
    const apptId = asBody<DataEnvelope<{ appointment: { id: string } }>>(book.body).data.appointment
      .id;

    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });
    const master1Token = signAccessToken({
      sub: master1.id,
      companyId: company.id,
      role: Role.MASTER,
      tv: master1.tokenVersion,
    });
    const master2Token = signAccessToken({
      sub: master2.id,
      companyId: company.id,
      role: Role.MASTER,
      tv: master2.tokenVersion,
    });
    const otherToken = signAccessToken({
      sub: otherOwner.id,
      companyId: otherCompany.id,
      role: Role.OWNER,
      tv: otherOwner.tokenVersion,
    });

    // Cross-tenant -> 404
    const crossRes = await request(app)
      .post(`/api/v1/appointments/${apptId}/prepayment`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ action: 'RECEIVED' });
    expect(crossRes.status).toBe(404);

    // Other master -> 404
    const m2Res = await request(app)
      .post(`/api/v1/appointments/${apptId}/prepayment`)
      .set('Authorization', `Bearer ${master2Token}`)
      .send({ action: 'RECEIVED' });
    expect(m2Res.status).toBe(404);

    // Master1 marks RECEIVED -> 200
    const m1Recv = await request(app)
      .post(`/api/v1/appointments/${apptId}/prepayment`)
      .set('Authorization', `Bearer ${master1Token}`)
      .send({ action: 'RECEIVED' });
    expect(m1Recv.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ prepaymentStatus: string }>>(m1Recv.body).data.prepaymentStatus,
    ).toBe(PrepaymentStatus.RECEIVED);

    // Master1 tries REFUND -> 403 FORBIDDEN
    const m1Refund = await request(app)
      .post(`/api/v1/appointments/${apptId}/prepayment`)
      .set('Authorization', `Bearer ${master1Token}`)
      .send({ action: 'REFUND' });
    expect(m1Refund.status).toBe(403);

    // Owner tries WAIVE on RECEIVED -> 409 INVALID_STATUS_TRANSITION
    const invalidWaive = await request(app)
      .post(`/api/v1/appointments/${apptId}/prepayment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'WAIVE' });
    expect(invalidWaive.status).toBe(409);

    // Owner marks REFUND -> 200
    const ownerRefund = await request(app)
      .post(`/api/v1/appointments/${apptId}/prepayment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'REFUND' });
    expect(ownerRefund.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ prepaymentStatus: string }>>(ownerRefund.body).data.prepaymentStatus,
    ).toBe(PrepaymentStatus.REFUNDED);
  });
});
