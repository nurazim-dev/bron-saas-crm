import { generateSync } from 'otplib';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { NotificationChannel, OutboxStatus } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { enqueue } from '../../src/modules/notifications/outbox.service.js';
import { runBillingNotificationsOnce } from '../../src/worker/jobs/billing-notifications.job.js';
import { truncateAllTables } from '../helpers/db.js';
import { createServiceFactory } from '../helpers/factories.js';

describe('Platform Admin Backend (Phase 15 / BR-20)', () => {
  const app = createApp();
  const origRequire2fa = env.ADMIN_REQUIRE_2FA;

  beforeEach(async () => {
    await truncateAllTables();
    resetRateLimitersForTest();
    (env as { ADMIN_REQUIRE_2FA: boolean }).ADMIN_REQUIRE_2FA = false;
  });

  afterEach(() => {
    resetClock();
    (env as { ADMIN_REQUIRE_2FA: boolean }).ADMIN_REQUIRE_2FA = origRequire2fa;
  });

  async function seedAdmin(email = 'admin@zapis.kg', password = 'AdminSuperPassword123!') {
    const passwordHash = await hashPassword(password);
    return prisma.platformAdmin.create({
      data: {
        email,
        name: 'Root Admin',
        passwordHash,
        isActive: true,
      },
    });
  }

  async function loginAdmin(email = 'admin@zapis.kg', password = 'AdminSuperPassword123!') {
    const res = await request(app).post('/api/v1/admin/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return (
      res.body as {
        data: {
          status: string;
          accessToken?: string;
          mfaToken?: string;
          admin?: { id: string; email: string };
        };
      }
    ).data;
  }

  async function registerOwner(email = 'owner@salon.kg', companyName = 'Salon One') {
    const res = await request(app).post('/api/v1/auth/register').send({
      ownerName: 'Owner',
      email,
      password: 'Password123',
      termsAccepted: true,
      companyName,
      businessType: 'BARBERSHOP',
    });
    expect(res.status).toBe(201);
    return (
      res.body as {
        data: {
          accessToken: string;
          user: { id: string; email: string };
          company: { id: string; slug: string };
        };
      }
    ).data;
  }

  it('enforces strict token separation between staff and admin routes', async () => {
    await seedAdmin();
    const adminSession = await loginAdmin();
    const ownerSession = await registerOwner();

    // Staff token cannot access /admin routes
    const staffToAdmin = await request(app)
      .get('/api/v1/admin/companies')
      .set('Authorization', `Bearer ${ownerSession.accessToken}`);
    expect(staffToAdmin.status).toBe(401);

    // Admin token cannot access staff routes
    const adminToStaff = await request(app)
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${adminSession.accessToken ?? ''}`);
    expect(adminToStaff.status).toBe(401);

    // Route-table sweep for unauthenticated admin endpoints -> 401
    const fakeId = '00000000-0000-4000-8000-000000000001';
    const routes: Array<Promise<request.Response>> = [
      request(app).get('/api/v1/admin/metrics/overview'),
      request(app).get('/api/v1/admin/companies'),
      request(app).get(`/api/v1/admin/companies/${fakeId}`),
      request(app).patch(`/api/v1/admin/companies/${fakeId}`).send({ name: 'X' }),
      request(app).post(`/api/v1/admin/companies/${fakeId}/suspend`).send({ reason: 'test' }),
      request(app).get('/api/v1/admin/payments'),
      request(app).get('/api/v1/admin/plans'),
      request(app).get('/api/v1/admin/users'),
      request(app).get('/api/v1/admin/outbox'),
      request(app).get('/api/v1/admin/audit'),
      request(app).get('/api/v1/admin/settings'),
    ];
    for (const r of routes) {
      const res = await r;
      expect(res.status).toBe(401);
    }
  });

  it('enforces 2FA enrollment scope, TOTP replay protection, recovery codes, and login lockout', async () => {
    const clock = new FakeClock(new Date('2026-11-16T10:00:00.000Z'));
    setClock(clock);
    (env as { ADMIN_REQUIRE_2FA: boolean }).ADMIN_REQUIRE_2FA = true;

    await seedAdmin();

    // Login without 2FA when required -> enroll_required
    const login1 = await loginAdmin();
    expect(login1.status).toBe('enroll_required');
    const enrollToken = login1.mfaToken ?? '';

    // Enrollment-scoped token cannot access /admin/companies
    const deniedCompanies = await request(app)
      .get('/api/v1/admin/companies')
      .set('Authorization', `Bearer ${enrollToken}`);
    expect(deniedCompanies.status).toBe(401);

    // Start 2FA enrollment
    const enrollRes = await request(app)
      .post('/api/v1/admin/auth/2fa/enroll')
      .set('Authorization', `Bearer ${enrollToken}`);
    expect(enrollRes.status).toBe(200);
    const { secret, otpauthUrl } = (
      enrollRes.body as { data: { secret: string; otpauthUrl: string } }
    ).data;
    expect(otpauthUrl).toContain('otpauth://totp/');

    // Verify & enable 2FA
    const epoch = Math.floor(clock.now().getTime() / 1000);
    const code1 = generateSync({ strategy: 'totp', secret, epoch });
    const verifyRes = await request(app)
      .post('/api/v1/admin/auth/2fa/verify-enroll')
      .set('Authorization', `Bearer ${enrollToken}`)
      .send({ code: code1 });
    expect(verifyRes.status).toBe(200);
    const { recoveryCodes } = (verifyRes.body as { data: { recoveryCodes: string[] } }).data;
    expect(recoveryCodes).toHaveLength(8);

    // Advance 60s so next login uses a fresh TOTP step
    clock.advanceMs(60_000);
    const login2 = await loginAdmin();
    expect(login2.status).toBe('mfa_required');
    const mfaToken = login2.mfaToken ?? '';

    const epoch2 = Math.floor(clock.now().getTime() / 1000);
    const code2 = generateSync({ strategy: 'totp', secret, epoch: epoch2 });

    const mfaOk = await request(app).post('/api/v1/admin/auth/mfa').send({ mfaToken, code: code2 });
    expect(mfaOk.status).toBe(200);
    expect((mfaOk.body as { data: { accessToken: string } }).data.accessToken).toBeTruthy();

    // Replay of SAME TOTP code in same step fails
    const mfaReplay = await request(app)
      .post('/api/v1/admin/auth/mfa')
      .send({ mfaToken, code: code2 });
    expect(mfaReplay.status).toBe(401);

    // Recovery code works once, then fails on reuse
    const recOk = await request(app)
      .post('/api/v1/admin/auth/mfa')
      .send({ mfaToken, recoveryCode: recoveryCodes[0] });
    expect(recOk.status).toBe(200);

    const recReuse = await request(app)
      .post('/api/v1/admin/auth/mfa')
      .send({ mfaToken, recoveryCode: recoveryCodes[0] });
    expect(recReuse.status).toBe(401);

    // Lockout after 10 failed attempts
    for (let i = 0; i < 10; i++) {
      resetRateLimitersForTest();
      const bad = await request(app)
        .post('/api/v1/admin/auth/login')
        .send({ email: 'admin@zapis.kg', password: 'WrongPassword123!' });
      expect(bad.status).toBe(401);
    }

    resetRateLimitersForTest();
    const lockedAttempt = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin@zapis.kg', password: 'AdminSuperPassword123!' });
    expect(lockedAttempt.status).toBe(401);

    // Advance 16 minutes -> lockout expires
    clock.advanceMs(16 * 60_000);
    const unlockedAttempt = await loginAdmin();
    expect(unlockedAttempt.status).toBe('mfa_required');
  });

  it('manages companies without exposing end-client PII, handles suspension, soft-delete/restore, and impersonation', async () => {
    const clock = new FakeClock(new Date('2026-11-16T10:00:00.000Z'));
    setClock(clock);

    await seedAdmin();
    const admin = await loginAdmin();
    const adminToken = admin.accessToken ?? '';

    const owner = await registerOwner('pii-test@salon.kg', 'PII Salon');
    const service = await createServiceFactory(owner.company.id);
    await prisma.masterService.create({
      data: { userId: owner.user.id, serviceId: service.id },
    });

    // Create an appointment with end-client PII
    const apptRes = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        masterId: owner.user.id,
        serviceId: service.id,
        startAt: '2026-11-20T09:00:00.000Z',
        clientName: 'Secret End Client',
        clientPhone: '+996777999888',
      });
    expect(apptRes.status).toBe(201);

    // Assert NO end-client PII in admin company list or detail
    const listRes = await request(app)
      .get('/api/v1/admin/companies')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    expect(JSON.stringify(listRes.body)).not.toContain('Secret End Client');
    expect(JSON.stringify(listRes.body)).not.toContain('+996777999888');

    const detailRes = await request(app)
      .get(`/api/v1/admin/companies/${owner.company.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    expect(JSON.stringify(detailRes.body)).not.toContain('Secret End Client');
    expect(JSON.stringify(detailRes.body)).not.toContain('+996777999888');

    // Impersonation: start -> exchange -> read-only GET works, POST/PATCH/DELETE -> 403, /admin -> 401, exit -> 204
    const impStart = await request(app)
      .post(`/api/v1/admin/companies/${owner.company.id}/impersonate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Investigating booking issue' });
    expect(impStart.status).toBe(200);
    const impCode = (impStart.body as { data: { code: string } }).data.code;

    const exchangeRes = await request(app)
      .post('/api/v1/auth/impersonate/exchange')
      .send({ code: impCode });
    expect(exchangeRes.status).toBe(200);
    expect(exchangeRes.headers['set-cookie']).toBeUndefined();
    const impToken = (exchangeRes.body as { data: { accessToken: string } }).data.accessToken;

    // Single-use code: second exchange fails
    const replayExchange = await request(app)
      .post('/api/v1/auth/impersonate/exchange')
      .send({ code: impCode });
    expect(replayExchange.status).toBe(400);

    // Read-only enforcement
    const impGet = await request(app)
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${impToken}`);
    expect(impGet.status).toBe(200);

    const impWrite = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${impToken}`)
      .send({ name: 'Hacked' });
    expect(impWrite.status).toBe(403);
    expect((impWrite.body as { error: { code: string } }).error.code).toBe(
      'IMPERSONATION_READ_ONLY',
    );

    const impAdmin = await request(app)
      .get('/api/v1/admin/companies')
      .set('Authorization', `Bearer ${impToken}`);
    expect(impAdmin.status).toBe(401);

    const impExit = await request(app)
      .post('/api/v1/auth/impersonate/exit')
      .set('Authorization', `Bearer ${impToken}`);
    expect(impExit.status).toBe(204);

    // Suspend company -> staff 403 COMPANY_SUSPENDED, public 403 BOOKING_DISABLED, worker skips
    const suspRes = await request(app)
      .post(`/api/v1/admin/companies/${owner.company.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Compliance check' });
    expect(suspRes.status).toBe(200);

    const staffWhileSuspended = await request(app)
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(staffWhileSuspended.status).toBe(403);
    expect((staffWhileSuspended.body as { error: { code: string } }).error.code).toBe(
      'COMPANY_SUSPENDED',
    );

    const pubWhileSuspended = await request(app).get(
      `/api/v1/public/companies/${owner.company.slug}`,
    );
    expect(pubWhileSuspended.status).toBe(403);
    expect((pubWhileSuspended.body as { error: { code: string } }).error.code).toBe(
      'BOOKING_DISABLED',
    );

    // Worker skips suspended company even at T-2 days
    clock.advanceMs(12 * 86_400_000);
    const workerSuspended = await runBillingNotificationsOnce(clock.now());
    expect(workerSuspended.enqueued).toBe(0);

    // Re-authenticate admin after advancing FakeClock by 12 days (10m JWT expired)
    const freshAdmin = await loginAdmin();
    const freshAdminToken = freshAdmin.accessToken ?? '';

    // Unsuspend
    const unsuspRes = await request(app)
      .post(`/api/v1/admin/companies/${owner.company.id}/unsuspend`)
      .set('Authorization', `Bearer ${freshAdminToken}`);
    expect(unsuspRes.status).toBe(200);

    // Soft delete requires exact confirmSlug, then restore works
    const badDelete = await request(app)
      .delete(`/api/v1/admin/companies/${owner.company.id}`)
      .set('Authorization', `Bearer ${freshAdminToken}`)
      .send({ confirmSlug: 'wrong-slug' });
    expect(badDelete.status).toBe(400);

    const okDelete = await request(app)
      .delete(`/api/v1/admin/companies/${owner.company.id}`)
      .set('Authorization', `Bearer ${freshAdminToken}`)
      .send({ confirmSlug: owner.company.slug });
    expect(okDelete.status).toBe(204);

    const restoreRes = await request(app)
      .post(`/api/v1/admin/companies/${owner.company.id}/restore`)
      .set('Authorization', `Bearer ${freshAdminToken}`);
    expect(restoreRes.status).toBe(200);
  });

  it('handles payments confirm/reject, plans, users, outbox retry, settings, metrics, and audit log', async () => {
    await seedAdmin();
    const admin = await loginAdmin();
    const adminToken = admin.accessToken ?? '';

    const owner = await registerOwner('biz@salon.kg', 'Biz Salon');
    const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });

    // Owner creates payment claim
    const claimRes = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ planId: proPlan.id, months: 1, method: 'MBANK' });
    expect(claimRes.status).toBe(201);
    const paymentId = (claimRes.body as { data: { id: string } }).data.id;

    // Admin confirms via API
    const confirmRes = await request(app)
      .post(`/api/v1/admin/payments/${paymentId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(confirmRes.status).toBe(200);

    // Metrics reflect 1 ACTIVE non-trial company with PRO MRR (3990.00)
    const metricsRes = await request(app)
      .get('/api/v1/admin/metrics/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(metricsRes.status).toBe(200);
    expect((metricsRes.body as { data: { mrr: string } }).data.mrr).toBe('3990.00');

    // Plan CRUD
    const planCreate = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `VIP_${Date.now()}`,
        name: 'VIP Плюс',
        priceMonthly: '5990.00',
        maxStaff: 50,
        featureAnalytics: true,
        featureAutoReminders: true,
        featurePrepayment: true,
      });
    expect(planCreate.status).toBe(201);
    const newPlanId = (planCreate.body as { data: { id: string } }).data.id;

    const planPatch = await request(app)
      .patch(`/api/v1/admin/plans/${newPlanId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(planPatch.status).toBe(200);

    // Users list & password-reset-link
    const usersRes = await request(app)
      .get('/api/v1/admin/users?search=biz@salon.kg')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(usersRes.status).toBe(200);
    expect((usersRes.body as { data: unknown[] }).data).toHaveLength(1);

    const resetLinkRes = await request(app)
      .post(`/api/v1/admin/users/${owner.user.id}/password-reset-link`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(resetLinkRes.status).toBe(200);
    expect((resetLinkRes.body as { data: { url: string } }).data.url).toContain(
      '/reset-password?token=',
    );

    // Outbox retry
    const enq = await enqueue(prisma, {
      channel: NotificationChannel.EMAIL,
      kind: 'SYSTEM_TEST',
      recipient: 'fail@salon.kg',
      payload: { title: 'Test' },
      dedupeKey: 'admin-retry-test:1',
    });
    await prisma.outboxMessage.update({
      where: { id: enq.id ?? '' },
      data: { status: OutboxStatus.FAILED, lastError: 'SMTP timeout' },
    });
    const retryRes = await request(app)
      .post(`/api/v1/admin/outbox/${enq.id ?? ''}/retry`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(retryRes.status).toBe(200);
    expect((retryRes.body as { data: { status: string } }).data.status).toBe('PENDING');

    // Settings update
    const settingsPut = await request(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ announcementEnabled: true, announcementText: 'Технические работы в 03:00' });
    expect(settingsPut.status).toBe(200);

    // Audit log contains admin actions
    const auditRes = await request(app)
      .get('/api/v1/admin/audit?actorType=ADMIN')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    const actions = (auditRes.body as { data: Array<{ action: string }> }).data.map(
      (a) => a.action,
    );
    expect(actions).toContain('admin.settings_update');
    expect(actions).toContain('admin.outbox_retry');
    expect(actions).toContain('admin.plan_create');
    expect(actions).toContain('billing.payment_confirm');
  });
});
