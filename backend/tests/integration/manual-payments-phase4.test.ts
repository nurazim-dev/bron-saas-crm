import { DateTime } from 'luxon';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { SubscriptionStatus } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { hashPassword } from '../../src/lib/password.js';
import { disconnectPrisma, prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { truncateAllTables } from '../helpers/db.js';
import { createAppointmentFactory, createServiceFactory } from '../helpers/factories.js';

const app = createApp();

async function registerCompanyOwner(companyName: string, email: string) {
  const res = await request(app).post('/api/v1/auth/register').send({
    companyName,
    businessType: 'BARBERSHOP',
    ownerName: 'Владелец',
    email,
    password: 'Password123!',
    termsAccepted: true,
  });
  expect(res.status).toBe(201);
  return (
    res.body as {
      data: {
        accessToken: string;
        user: { id: string };
        company: { id: string; slug: string };
      };
    }
  ).data;
}

async function createValidPngBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 15, g: 118, b: 110 } },
  })
    .png()
    .toBuffer();
}

function createValidPdfBuffer(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  );
}

describe('Phase 4 Manual Payments: BusinessPayment, PaymentProof, Admin isolation', () => {
  const origRequire2fa = env.ADMIN_REQUIRE_2FA;

  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
    (env as { ADMIN_REQUIRE_2FA: boolean }).ADMIN_REQUIRE_2FA = false;
  });

  afterEach(() => {
    resetClock();
    (env as { ADMIN_REQUIRE_2FA: boolean }).ADMIN_REQUIRE_2FA = origRequire2fa;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('tracks partial payments, prepayments, refunds, proofs without auto-confirm, and atomic confirm/reject', async () => {
    setClock(new FakeClock('2026-11-19T10:00:00.000Z'));

    const owner = await registerCompanyOwner('Pay Salon', 'pay-owner@example.test');
    const auth = { Authorization: `Bearer ${owner.accessToken}` };

    const svc = await createServiceFactory(owner.company.id, {
      name: 'Окрашивание',
      price: '2000.00',
      durationMin: 90,
    });
    const appt = await createAppointmentFactory({
      companyId: owner.company.id,
      masterId: owner.user.id,
      serviceId: svc.id,
      clientName: 'Алия Клиент',
      clientPhone: '+996555700100',
      startAt: DateTime.fromISO('2026-11-19T11:00:00Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-19T12:30:00Z').toJSDate(),
      price: '2000.00',
      status: 'COMPLETED',
    });
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { prepaymentStatus: 'PENDING', prepaymentAmount: '500.00' },
    });

    // 1. Create pending prepayment (500 KGS)
    const prepaymentRes = await request(app)
      .post('/api/v1/payments')
      .set(auth)
      .send({
        appointmentId: appt.id,
        kind: 'PREPAYMENT',
        amount: '500',
        method: 'MBANK',
        reference: 'MB-001',
      })
      .expect(201);
    const prepayId = (prepaymentRes.body as { data: { id: string; status: string } }).data.id;
    expect((prepaymentRes.body as { data: { status: string } }).data.status).toBe('PENDING');

    // Upload valid PNG proof + valid PDF proof; reject spoofed/invalid bytes
    const pngBuf = await createValidPngBuffer();
    const pdfBuf = createValidPdfBuffer();

    await request(app)
      .post(`/api/v1/payments/${prepayId}/proofs`)
      .set(auth)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not-really-a-png'))
      .expect(422);

    const proof1Res = await request(app)
      .post(`/api/v1/payments/${prepayId}/proofs`)
      .set(auth)
      .set('Content-Type', 'image/png')
      .set('x-file-name', encodeURIComponent('чеки.png'))
      .send(pngBuf)
      .expect(201);
    const proof1Id = (proof1Res.body as { data: { id: string; mime: string } }).data.id;
    expect((proof1Res.body as { data: { mime: string } }).data.mime).toBe('image/webp');

    await request(app)
      .post(`/api/v1/payments/${prepayId}/proofs`)
      .set(auth)
      .set('Content-Type', 'application/pdf')
      .set('x-file-name', 'receipt.pdf')
      .send(pdfBuf)
      .expect(201);

    // Uploading proofs must NEVER auto-confirm the payment
    const summaryBeforeConfirm = await request(app)
      .get('/api/v1/payments/summary')
      .set(auth)
      .query({ from: '2026-11-19', to: '2026-11-19' })
      .expect(200);
    expect((summaryBeforeConfirm.body as { data: Record<string, unknown> }).data).toMatchObject({
      confirmedPayments: '0.00',
      confirmedRefunds: '0.00',
      netConfirmedRevenue: '0.00',
      pendingAmount: '500.00',
      pendingCount: 1,
      completedAppointmentsEstimate: '2000.00',
    });

    // Enforce <= 5 proofs per payment
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post(`/api/v1/payments/${prepayId}/proofs`)
        .set(auth)
        .set('Content-Type', 'image/png')
        .send(pngBuf)
        .expect(201);
    }
    await request(app)
      .post(`/api/v1/payments/${prepayId}/proofs`)
      .set(auth)
      .set('Content-Type', 'image/png')
      .send(pngBuf)
      .expect(409);

    // Owner downloads private proof with nosniff + no-store headers
    const downloadRes = await request(app)
      .get(`/api/v1/payments/${prepayId}/proofs/${proof1Id}`)
      .set(auth)
      .expect(200);
    expect(downloadRes.headers['x-content-type-options']).toBe('nosniff');
    expect(downloadRes.headers['cache-control']).toBe('private, no-store');

    // Confirm prepayment -> sets CONFIRMED, syncs appointment prepayment RECEIVED, writes AuditLog + OutboxMessage
    const confirmRes = await request(app)
      .post(`/api/v1/payments/${prepayId}/confirm`)
      .set(auth)
      .expect(200);
    expect((confirmRes.body as { data: { status: string } }).data.status).toBe('CONFIRMED');

    // Second confirm returns 409 ALREADY_REVIEWED and does NOT duplicate outbox
    await request(app).post(`/api/v1/payments/${prepayId}/confirm`).set(auth).expect(409);
    await request(app)
      .post(`/api/v1/payments/${prepayId}/reject`)
      .set(auth)
      .send({ reason: 'Повтор' })
      .expect(409);

    const updatedAppt = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(updatedAppt.prepaymentStatus).toBe('RECEIVED');

    const outboxConfirmCount = await prisma.outboxMessage.count({
      where: { companyId: owner.company.id, dedupeKey: `business-payment:confirmed:${prepayId}` },
    });
    expect(outboxConfirmCount).toBe(1);

    // Partial payment (1500 KGS, immediate confirm) + Refund cap check (> 2000 blocked) + valid partial refund (300)
    await request(app)
      .post('/api/v1/payments')
      .set(auth)
      .send({
        appointmentId: appt.id,
        kind: 'PAYMENT',
        amount: '1500.00',
        method: 'CASH',
        confirmImmediately: true,
      })
      .expect(201);

    await request(app)
      .post('/api/v1/payments')
      .set(auth)
      .send({
        appointmentId: appt.id,
        kind: 'REFUND',
        amount: '2500.00',
        method: 'CASH',
      })
      .expect(409);

    await request(app)
      .post('/api/v1/payments')
      .set(auth)
      .send({
        appointmentId: appt.id,
        kind: 'REFUND',
        amount: '300.00',
        method: 'CASH',
        confirmImmediately: true,
      })
      .expect(201);

    // Pending rejected payment doesn't affect net revenue
    const toRejectRes = await request(app)
      .post('/api/v1/payments')
      .set(auth)
      .send({
        appointmentId: appt.id,
        kind: 'PAYMENT',
        amount: '100.00',
        method: 'ELCART',
      })
      .expect(201);
    const toRejectId = (toRejectRes.body as { data: { id: string } }).data.id;
    await request(app)
      .post(`/api/v1/payments/${toRejectId}/reject`)
      .set(auth)
      .send({ reason: 'Чек не найден' })
      .expect(200);

    const summaryAfter = await request(app)
      .get('/api/v1/payments/summary')
      .set(auth)
      .query({ from: '2026-11-19', to: '2026-11-19' })
      .expect(200);
    expect((summaryAfter.body as { data: Record<string, unknown> }).data).toMatchObject({
      confirmedPayments: '2000.00',
      confirmedRefunds: '300.00',
      netConfirmedRevenue: '1700.00',
      pendingAmount: '0.00',
      pendingCount: 0,
      completedAppointmentsEstimate: '2000.00',
    });
  });

  it('enforces subscription proof upload when LOCKED, tenant/admin boundaries, and staff RBAC', async () => {
    setClock(new FakeClock('2026-11-19T10:00:00.000Z'));

    const ownerA = await registerCompanyOwner('Lock Salon A', 'pay-lock-a@example.test');
    const ownerB = await registerCompanyOwner('Other Salon B', 'pay-lock-b@example.test');
    const authA = { Authorization: `Bearer ${ownerA.accessToken}` };
    const authB = { Authorization: `Bearer ${ownerB.accessToken}` };

    // Invite MANAGER & verify 403 on /api/v1/payments
    const inviteRes = await request(app)
      .post('/api/v1/staff/invite')
      .set(authA)
      .send({ name: 'Менеджер', email: 'mgr-pay@example.test', role: 'MANAGER' })
      .expect(201);
    const inviteToken = new URL((inviteRes.body as { data: { url: string } }).data.url).hash.slice(
      1,
    );
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, newPassword: 'Password123!' })
      .expect(204);
    const mgrLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'mgr-pay@example.test', password: 'Password123!' })
      .expect(200);
    const mgrAuth = {
      Authorization: `Bearer ${(mgrLogin.body as { data: { accessToken: string } }).data.accessToken}`,
    };
    await request(app).get('/api/v1/payments').set(mgrAuth).expect(403);
    await request(app)
      .post('/api/v1/payments')
      .set(mgrAuth)
      .send({ kind: 'PAYMENT', amount: '100', method: 'CASH' })
      .expect(403);

    // Owner A business payment + proof must return 404 to Owner B
    const bizPayRes = await request(app)
      .post('/api/v1/payments')
      .set(authA)
      .send({ kind: 'PAYMENT', amount: '900', method: 'MBANK' })
      .expect(201);
    const bizPayId = (bizPayRes.body as { data: { id: string } }).data.id;
    const pngBuf = await createValidPngBuffer();
    const bizProofRes = await request(app)
      .post(`/api/v1/payments/${bizPayId}/proofs`)
      .set(authA)
      .set('Content-Type', 'image/png')
      .send(pngBuf)
      .expect(201);
    const bizProofId = (bizProofRes.body as { data: { id: string } }).data.id;

    await request(app)
      .get(`/api/v1/payments/${bizPayId}/proofs/${bizProofId}`)
      .set(authB)
      .expect(404);
    await request(app).post(`/api/v1/payments/${bizPayId}/confirm`).set(authB).expect(404);

    // Subscription payment claim + proof upload even when Company A subscription is LOCKED
    const plansRes = await request(app).get('/api/v1/billing/plans').set(authA).expect(200);
    const planId = (
      plansRes.body as { data: Array<{ id: string; priceMonthly: string }> }
    ).data.find((p) => Number(p.priceMonthly) > 0)?.id;
    expect(planId).toBeTruthy();

    const claimRes = await request(app)
      .post('/api/v1/billing/payments')
      .set(authA)
      .send({ planId, months: 1, method: 'MBANK', reference: 'SUB-001' })
      .expect(201);
    const claimId = (claimRes.body as { data: { id: string } }).data.id;

    // Lock Company A subscription (respecting periodStartsAt <= periodEndsAt check constraint)
    await prisma.subscription.update({
      where: { companyId: ownerA.company.id },
      data: {
        status: SubscriptionStatus.LOCKED,
        periodStartsAt: DateTime.fromISO('2026-10-01T00:00:00Z').toJSDate(),
        periodEndsAt: DateTime.fromISO('2026-11-01T00:00:00Z').toJSDate(),
      },
    });

    // Locked owner can still upload subscription payment proof (no requireWritableSubscription)
    const subProofRes = await request(app)
      .post(`/api/v1/billing/payments/${claimId}/proofs`)
      .set(authA)
      .set('Content-Type', 'image/png')
      .send(pngBuf)
      .expect(201);
    const subProofId = (subProofRes.body as { data: { id: string } }).data.id;

    // Proof upload must NOT confirm subscription claim
    const claimAfterProof = await prisma.subscriptionPayment.findUniqueOrThrow({
      where: { id: claimId },
    });
    expect(claimAfterProof.status).toBe('PENDING');

    // Cross-tenant owner cannot read Owner A's subscription proof
    await request(app)
      .get(`/api/v1/billing/payments/${claimId}/proofs/${subProofId}`)
      .set(authB)
      .expect(404);

    // Seed PlatformAdmin & login
    const passwordHash = await hashPassword('AdminPassword123!');
    await prisma.platformAdmin.create({
      data: {
        email: 'admin-p4@zapis.kg',
        name: 'Finance Admin',
        passwordHash,
        isActive: true,
      },
    });
    const adminLogin = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin-p4@zapis.kg', password: 'AdminPassword123!' })
      .expect(200);
    const adminAuth = {
      Authorization: `Bearer ${(adminLogin.body as { data: { accessToken: string } }).data.accessToken}`,
    };

    // Admin cannot access salon BusinessPayment endpoints or read BusinessPayment proof
    await request(app).get('/api/v1/payments').set(adminAuth).expect(401);
    await request(app)
      .get(`/api/v1/admin/payments/${bizPayId}/proofs/${bizProofId}`)
      .set(adminAuth)
      .expect(404);

    // Admin reads SubscriptionPayment proof and confirms payment ONCE (second confirm -> 409)
    await request(app)
      .get(`/api/v1/admin/payments/${claimId}/proofs/${subProofId}`)
      .set(adminAuth)
      .expect(200);

    const confirm1 = await request(app)
      .post(`/api/v1/admin/payments/${claimId}/confirm`)
      .set(adminAuth)
      .expect(200);
    const periodEnd1 = (confirm1.body as { data: { periodEnd: string } }).data.periodEnd;

    await request(app).post(`/api/v1/admin/payments/${claimId}/confirm`).set(adminAuth).expect(409);

    const subAfterDoubleConfirm = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: ownerA.company.id },
    });
    expect(subAfterDoubleConfirm.status).toBe('ACTIVE');
    expect(subAfterDoubleConfirm.periodEndsAt.toISOString()).toBe(periodEnd1);
  });
});
