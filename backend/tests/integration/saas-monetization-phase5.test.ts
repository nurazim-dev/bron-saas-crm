import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { adjustSubscription, confirmPayment } from '../../src/modules/billing/billing.service.js';
import { invalidatePublicPlatformCache } from '../../src/modules/platform/platform-settings.service.js';
import { truncateAllTables } from '../helpers/db.js';

describe('Phase 5 SaaS Monetization: FREE/BUSINESS/PRO matrix, limits, legacy START & admin plans', () => {
  const app = createApp();
  const origRequire2fa = env.ADMIN_REQUIRE_2FA;

  beforeEach(async () => {
    await truncateAllTables();
    resetRateLimitersForTest();
    invalidatePublicPlatformCache();
    (env as { ADMIN_REQUIRE_2FA: boolean }).ADMIN_REQUIRE_2FA = false;
    await prisma.platformSetting.upsert({
      where: { key: 'registrationOpen' },
      update: { value: true },
      create: { key: 'registrationOpen', value: true },
    });
  });

  afterEach(async () => {
    resetClock();
    invalidatePublicPlatformCache();
    (env as { ADMIN_REQUIRE_2FA: boolean }).ADMIN_REQUIRE_2FA = origRequire2fa;
    await prisma.subscription.deleteMany({
      where: { plan: { code: 'TEST_MINI' } },
    });
    await prisma.plan.deleteMany({
      where: { code: 'TEST_MINI' },
    });
  });

  async function seedAndLoginAdmin() {
    const password = 'AdminSuperPassword123!';
    const passwordHash = await hashPassword(password);
    await prisma.platformAdmin.create({
      data: {
        email: 'saas-admin@zapis.kg',
        name: 'SaaS Admin',
        passwordHash,
        isActive: true,
      },
    });
    const loginRes = await request(app).post('/api/v1/admin/auth/login').send({
      email: 'saas-admin@zapis.kg',
      password,
    });
    expect(loginRes.status).toBe(200);
    return (loginRes.body as { data: { accessToken: string } }).data.accessToken;
  }

  async function registerOwner(email: string, companyName: string) {
    const res = await request(app).post('/api/v1/auth/register').send({
      ownerName: 'Владелец Тест',
      email,
      password: 'Password123!',
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

  it('serves FREE/BUSINESS/PRO lineup publicly while preserving legacy START tenant access and renewals', async () => {
    const clock = new FakeClock(new Date('2026-11-05T10:00:00.000Z'));
    setClock(clock);

    const ownerBiz = await registerOwner('biz@salon.kg', 'Business Salon');
    const ownerLegacy = await registerOwner('legacy@salon.kg', 'Legacy Start Salon');

    const platformRes = await request(app).get('/api/v1/public/platform');
    expect(platformRes.status).toBe(200);
    const platformPlans = (
      platformRes.body as {
        data: {
          plans: Array<{
            code: string;
            priceMonthly: string;
            maxServices: number | null;
            maxAppointmentsPerMonth: number | null;
            featureCrmAdvanced: boolean;
            featureManualPayments: boolean;
            featureMultiCompany: boolean;
          }>;
        };
      }
    ).data.plans;
    expect(platformPlans.map((p) => p.code)).toEqual(['FREE', 'BUSINESS', 'PRO']);
    const freePlan = platformPlans.find((p) => p.code === 'FREE');
    expect(freePlan).toMatchObject({
      priceMonthly: '0.00',
      maxServices: 10,
      maxAppointmentsPerMonth: 50,
      featureCrmAdvanced: false,
      featureManualPayments: false,
      featureMultiCompany: false,
    });

    const startPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'START' } });
    expect(startPlan.isLegacy).toBe(true);
    expect(startPlan.isPublic).toBe(false);
    expect(startPlan.isActive).toBe(true);

    // Company on BUSINESS cannot claim non-public legacy START -> 404
    const claimStartFromBiz = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${ownerBiz.accessToken}`)
      .send({ planId: startPlan.id, months: 1, method: 'MBANK' });
    expect(claimStartFromBiz.status).toBe(404);

    // Legacy company already on START retains CRM/ManualPayments and can still submit renewal claim for START
    await adjustSubscription(ownerLegacy.company.id, null, {
      planId: startPlan.id,
      isTrial: false,
      reason: 'Legacy START migration preservation',
    });

    const tagRes = await request(app)
      .post('/api/v1/clients/tags')
      .set('Authorization', `Bearer ${ownerLegacy.accessToken}`)
      .send({ name: 'Старый клиент' });
    expect(tagRes.status).toBe(201);

    const payRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${ownerLegacy.accessToken}`)
      .send({ kind: 'PAYMENT', amount: '500.00', method: 'CASH', confirmImmediately: true });
    expect(payRes.status).toBe(201);

    const renewStartRes = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${ownerLegacy.accessToken}`)
      .send({ planId: startPlan.id, months: 1, method: 'MBANK' });
    expect(renewStartRes.status).toBe(201);
  });

  it('rejects claim for FREE, allows LOCKED switch to FREE preserving historical data, keeps pending claim separate, and enforces matrix gates', async () => {
    const clock = new FakeClock(new Date('2026-11-01T10:00:00.000Z'));
    setClock(clock);

    const owner = await registerOwner('free-switch@salon.kg', 'Switch Salon');
    const freePlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
    const businessPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'BUSINESS' } });

    // Create historical tag + historical business payment while still on BUSINESS trial
    const tagBefore = await request(app)
      .post('/api/v1/clients/tags')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'VIP' });
    expect(tagBefore.status).toBe(201);

    const payBefore = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ kind: 'PAYMENT', amount: '700.00', method: 'MBANK', confirmImmediately: true });
    expect(payBefore.status).toBe(201);

    // Claiming FREE via payment claim fails with 422
    const claimFreeRes = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ planId: freePlan.id, months: 1, method: 'MBANK' });
    expect(claimFreeRes.status).toBe(422);

    // Advance 18 days -> subscription becomes LOCKED (14 trial + 3 grace)
    clock.advanceMs(18 * 86_400_000);
    const loginLocked = await request(app).post('/api/v1/auth/login').send({
      email: owner.user.email,
      password: 'Password123!',
    });
    expect(loginLocked.status).toBe(200);
    const tokenLocked = (loginLocked.body as { data: { accessToken: string } }).data.accessToken;

    // Even when LOCKED, switch-free succeeds cleanly without deleting historical data
    const switchRes = await request(app)
      .post('/api/v1/billing/switch-free')
      .set('Authorization', `Bearer ${tokenLocked}`);
    expect(switchRes.status).toBe(200);
    const switchData = (
      switchRes.body as {
        data: {
          subscription: { state: string; plan: { code: string } };
          usage: {
            activeServicesCount: number;
            maxServices: number | null;
            monthlyAppointmentsCount: number;
            maxAppointmentsPerMonth: number | null;
            monthlyRemindersCount: number;
          };
        };
      }
    ).data;
    expect(switchData.subscription.state).toBe('ACTIVE');
    expect(switchData.subscription.plan.code).toBe('FREE');
    expect(switchData.usage.maxServices).toBe(10);
    expect(switchData.usage.maxAppointmentsPerMonth).toBe(50);

    // Historical payment remains readable (200), while writing new payment/CRM ops returns 402 FEATURE_NOT_IN_PLAN
    const histPayGet = await request(app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${tokenLocked}`);
    expect(histPayGet.status).toBe(200);
    expect((histPayGet.body as { data: Array<{ id: string }> }).data).toHaveLength(1);

    const gatedPayCreate = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${tokenLocked}`)
      .send({ kind: 'PAYMENT', amount: '200.00', method: 'CASH' });
    expect(gatedPayCreate.status).toBe(402);
    expect((gatedPayCreate.body as { error: { code: string } }).error.code).toBe(
      'FEATURE_NOT_IN_PLAN',
    );

    const gatedTagCreate = await request(app)
      .post('/api/v1/clients/tags')
      .set('Authorization', `Bearer ${tokenLocked}`)
      .send({ name: 'Blocked Tag' });
    expect(gatedTagCreate.status).toBe(402);
    expect((gatedTagCreate.body as { error: { code: string } }).error.code).toBe(
      'FEATURE_NOT_IN_PLAN',
    );

    const gatedMerge = await request(app)
      .post('/api/v1/clients/merge/preview')
      .set('Authorization', `Bearer ${tokenLocked}`)
      .send({ sourceClientId: owner.user.id, targetClientId: owner.user.id });
    expect(gatedMerge.status).toBe(402);

    const gatedMultiCompany = await request(app)
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${tokenLocked}`)
      .send({ companyName: 'Second Branch', businessType: 'BARBERSHOP' });
    expect(gatedMultiCompany.status).toBe(402);
    expect((gatedMultiCompany.body as { error: { code: string } }).error.code).toBe(
      'FEATURE_NOT_IN_PLAN',
    );

    // Submit paid BUSINESS claim -> pendingClaim exists separately, subscription stays on FREE until confirmed
    const claimBizRes = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${tokenLocked}`)
      .send({ planId: businessPlan.id, months: 1, method: 'MBANK', reference: 'UPG-01' });
    expect(claimBizRes.status).toBe(201);
    const claimId = (claimBizRes.body as { data: { id: string } }).data.id;

    const stillFreeOverview = await request(app)
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${tokenLocked}`);
    expect(stillFreeOverview.status).toBe(200);
    const stillFreeData = (
      stillFreeOverview.body as {
        data: {
          subscription: { plan: { code: string } };
          pendingClaim: { id: string } | null;
        };
      }
    ).data;
    expect(stillFreeData.subscription.plan.code).toBe('FREE');
    expect(stillFreeData.pendingClaim?.id).toBe(claimId);

    // Admin confirms -> company moves to BUSINESS and gated features unlock
    await confirmPayment(claimId, null);

    const unlockedTagRes = await request(app)
      .post('/api/v1/clients/tags')
      .set('Authorization', `Bearer ${tokenLocked}`)
      .send({ name: 'Unlocked Tag' });
    expect(unlockedTagRes.status).toBe(201);
  });

  it('enforces maxServices and maxAppointmentsPerMonth and reflects live admin plan edits', async () => {
    const clock = new FakeClock(new Date('2026-11-10T07:00:00.000Z'));
    setClock(clock);

    const adminToken = await seedAndLoginAdmin();
    const owner = await registerOwner('limits@salon.kg', 'Limits Salon');

    // Admin creates custom compact plan TEST_MINI (maxServices=1, maxAppointmentsPerMonth=1, crmAdvanced=false)
    const createPlanRes = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'TEST_MINI',
        name: 'Мини Тест',
        description: 'Компактный тест лимитов',
        priceMonthly: '490.00',
        maxStaff: 2,
        maxServices: 1,
        maxAppointmentsPerMonth: 1,
        maxRemindersPerMonth: 0,
        featureAnalytics: false,
        featureAutoReminders: false,
        featurePrepayment: false,
        featureCrmAdvanced: false,
        featureManualPayments: false,
        featureMultiCompany: false,
        featureCustomBranding: false,
        isPublic: true,
        sortOrder: 9,
      });
    expect(createPlanRes.status).toBe(201);
    const miniPlanId = (createPlanRes.body as { data: { id: string } }).data.id;

    await adjustSubscription(owner.company.id, null, {
      planId: miniPlanId,
      isTrial: false,
      reason: 'Attach TEST_MINI for limit checks',
    });

    // Configure working hours on owner (weekday=2 Tue..6) so public booking can run
    const whRes = await request(app)
      .put(`/api/v1/staff/${owner.user.id}/working-hours`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        days: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '19:00',
          breakStart: null,
          breakEnd: null,
        })),
      });
    expect(whRes.status).toBe(200);

    // 1st service succeeds, 2nd service fails with 402 PLAN_LIMIT_REACHED
    const s1 = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Стрижка 1', durationMin: 30, price: '500' });
    expect(s1.status).toBe(201);
    const svc1Id = (s1.body as { data: { id: string } }).data.id;

    expect(
      (
        await request(app)
          .put(`/api/v1/staff/${owner.user.id}/services`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ serviceIds: [svc1Id] })
      ).status,
    ).toBe(200);

    const s2Fail = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Стрижка 2', durationMin: 30, price: '500' });
    expect(s2Fail.status).toBe(402);
    expect((s2Fail.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT_REACHED');

    // 1st appointment (staff) succeeds, 2nd (staff) fails 402 PLAN_LIMIT_REACHED, and public booking also fails 402 PLAN_LIMIT_REACHED
    const a1 = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        masterId: owner.user.id,
        serviceId: svc1Id,
        startAt: '2026-11-12T05:00:00.000Z',
        clientName: 'Клиент 1',
        clientPhone: '+996555300001',
      });
    expect(a1.status).toBe(201);

    const a2Fail = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        masterId: owner.user.id,
        serviceId: svc1Id,
        startAt: '2026-11-12T07:00:00.000Z',
        clientName: 'Клиент 2',
        clientPhone: '+996555300002',
      });
    expect(a2Fail.status).toBe(402);
    expect((a2Fail.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT_REACHED');

    const pubFail = await request(app)
      .post(`/api/v1/public/companies/${owner.company.slug}/appointments`)
      .send({
        masterId: owner.user.id,
        serviceId: svc1Id,
        startAt: '2026-11-13T05:00:00.000Z',
        clientName: 'Онлайн Клиент',
        clientPhone: '+996555300003',
        consentAccepted: true,
        website: '',
      });
    expect(pubFail.status).toBe(402);
    expect((pubFail.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT_REACHED');

    // Admin live updates TEST_MINI limits -> immediately unlocks creation
    const patchRes = await request(app)
      .patch(`/api/v1/admin/plans/${miniPlanId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        maxServices: 3,
        maxAppointmentsPerMonth: 5,
        featureCrmAdvanced: true,
      });
    expect(patchRes.status).toBe(200);

    const s2Ok = await request(app)
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Стрижка 2', durationMin: 30, price: '500' });
    expect(s2Ok.status).toBe(201);

    const tagOk = await request(app)
      .post('/api/v1/clients/tags')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Разблокирован' });
    expect(tagOk.status).toBe(201);

    // Admin cannot deactivate trialPlanCode (BUSINESS)
    const bizPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'BUSINESS' } });
    const deactivateTrialRes = await request(app)
      .patch(`/api/v1/admin/plans/${bizPlan.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(deactivateTrialRes.status).toBe(409);
  });
});
