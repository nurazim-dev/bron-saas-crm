import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  PaymentMethod,
  PaymentStatus,
  SubscriptionStatus,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  adjustSubscription,
  assertPlanFeature,
  confirmPayment,
  recordOfflinePayment,
  rejectPayment,
} from '../../src/modules/billing/billing.service.js';
import { invalidatePublicPlatformCache } from '../../src/modules/platform/platform-settings.service.js';
import { runBillingNotificationsOnce } from '../../src/worker/jobs/billing-notifications.job.js';
import { runBillingStateSyncOnce } from '../../src/worker/jobs/billing-state-sync.job.js';
import { truncateAllTables } from '../helpers/db.js';
import { createServiceFactory } from '../helpers/factories.js';

describe('Billing Core (Phase 14 / BR-19)', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    invalidatePublicPlatformCache();
    await prisma.platformSetting.update({
      where: { key: 'registrationOpen' },
      data: { value: true },
    });
  });

  afterEach(() => {
    resetClock();
    invalidatePublicPlatformCache();
  });

  async function registerOwner(email = 'billing-owner@salon.kg', companyName = 'Billing Salon') {
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

  it('creates trial subscription on registration and respects registrationOpen setting', async () => {
    const clock = new FakeClock(new Date('2026-11-01T10:00:00.000Z'));
    setClock(clock);

    const owner = await registerOwner();
    const overviewRes = await request(app)
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(overviewRes.status).toBe(200);
    const overview = (
      overviewRes.body as {
        data: {
          subscription: {
            state: string;
            isTrial: boolean;
            daysLeft: number;
            plan: { code: string };
          };
          usage: { activeStaffCount: number; maxStaff: number };
        };
      }
    ).data;
    expect(overview.subscription.state).toBe('TRIAL');
    expect(overview.subscription.isTrial).toBe(true);
    expect(overview.subscription.daysLeft).toBe(14);
    expect(overview.subscription.plan.code).toBe('BUSINESS');
    expect(overview.usage.activeStaffCount).toBe(1);

    // Public platform endpoint
    const platformRes = await request(app).get('/api/v1/public/platform');
    expect(platformRes.status).toBe(200);
    const platformBody = platformRes.body as {
      data: { plans: Array<{ code: string }>; registrationOpen: boolean };
    };
    expect(platformBody.data.plans.map((p) => p.code)).toEqual(['START', 'BUSINESS', 'PRO']);
    expect(platformBody.data.registrationOpen).toBe(true);

    // Close registration
    await prisma.platformSetting.update({
      where: { key: 'registrationOpen' },
      data: { value: false },
    });
    const closedRes = await request(app).post('/api/v1/auth/register').send({
      ownerName: 'Blocked',
      email: 'blocked@salon.kg',
      password: 'Password123',
      termsAccepted: true,
      companyName: 'Blocked Salon',
      businessType: 'BARBERSHOP',
    });
    expect(closedRes.status).toBe(403);
    expect((closedRes.body as { error: { code: string } }).error.code).toBe('REGISTRATION_CLOSED');
  });

  it('blocks mutating staff routes and public booking when LOCKED while preserving allowlist and GETs', async () => {
    const clock = new FakeClock(new Date('2026-11-01T10:00:00.000Z'));
    setClock(clock);

    const owner = await registerOwner();
    const service = await createServiceFactory(owner.company.id);

    // Advance 15 days -> PAST_DUE (grace=3 days -> ends Nov 18) -> still writable!
    clock.advanceMs(15 * 86_400_000);
    const loginPastDue = await request(app).post('/api/v1/auth/login').send({
      email: owner.user.email,
      password: 'Password123',
    });
    expect(loginPastDue.status).toBe(200);
    const freshToken = (loginPastDue.body as { data: { accessToken: string } }).data.accessToken;

    const pastDuePatch = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ name: 'Past Due Salon' });
    expect(pastDuePatch.status).toBe(200);

    // Advance 3 more days (18 days total) -> LOCKED
    clock.advanceMs(3 * 86_400_000);
    const loginLocked = await request(app).post('/api/v1/auth/login').send({
      email: owner.user.email,
      password: 'Password123',
    });
    expect(loginLocked.status).toBe(200);
    const lockedToken = (loginLocked.body as { data: { accessToken: string } }).data.accessToken;

    const lockedChecks = [
      request(app)
        .patch('/api/v1/company')
        .set('Authorization', `Bearer ${lockedToken}`)
        .send({ name: 'Should Fail' }),
      request(app)
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${lockedToken}`)
        .send({ name: 'Cut', durationMin: 30, price: '500.00', isActive: true }),
      request(app)
        .patch(`/api/v1/services/${service.id}`)
        .set('Authorization', `Bearer ${lockedToken}`)
        .send({ name: 'Updated' }),
      request(app)
        .delete(`/api/v1/services/${service.id}`)
        .set('Authorization', `Bearer ${lockedToken}`),
      request(app)
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${lockedToken}`)
        .send({ name: 'New Master', isActive: true, isBookable: true }),
      request(app).post('/api/v1/appointments').set('Authorization', `Bearer ${lockedToken}`).send({
        masterId: owner.user.id,
        serviceId: service.id,
        startAt: '2026-11-25T10:00:00.000Z',
        clientName: 'Client',
        clientPhone: '+996555111222',
      }),
    ];

    for (const reqPromise of lockedChecks) {
      const res = await reqPromise;
      expect(res.status).toBe(402);
      expect((res.body as { error: { code: string } }).error.code).toBe('SUBSCRIPTION_REQUIRED');
    }

    // GET routes keep working
    const getCompany = await request(app)
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${lockedToken}`);
    expect(getCompany.status).toBe(200);

    // Allowlisted mutating routes still work: notifications read-all, billing claim, auth password
    const readAll = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', `Bearer ${lockedToken}`);
    expect(readAll.status).toBe(200);

    const plans = await prisma.plan.findMany({ where: { code: 'START' } });
    const claimRes = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${lockedToken}`)
      .send({ planId: plans[0]?.id, months: 1, method: 'MBANK' });
    expect(claimRes.status).toBe(201);

    // Public booking & availability -> 403 BOOKING_DISABLED
    const pubProfile = await request(app).get(`/api/v1/public/companies/${owner.company.slug}`);
    expect(pubProfile.status).toBe(403);
    expect((pubProfile.body as { error: { code: string } }).error.code).toBe('BOOKING_DISABLED');

    const pubAvail = await request(app).get(
      `/api/v1/public/companies/${owner.company.slug}/availability?serviceId=${service.id}&date=2026-11-25`,
    );
    expect(pubAvail.status).toBe(403);
    expect((pubAvail.body as { error: { code: string } }).error.code).toBe('BOOKING_DISABLED');
  });

  it('enforces maxStaff plan limits on create/reactivate/restore, allows downgrade, and gates features', async () => {
    const owner = await registerOwner();
    const startPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'START' } }); // maxStaff = 2

    // Downgrade to START via adjustSubscription
    await adjustSubscription(owner.company.id, null, {
      planId: startPlan.id,
      isTrial: false,
      reason: 'Downgrade to START for test',
    });

    // Feature gate check on START
    await expect(assertPlanFeature(owner.company.id, 'analytics')).rejects.toMatchObject({
      code: 'FEATURE_NOT_IN_PLAN',
      httpStatus: 402,
    });

    // Owner counts as 1 -> creating 1 active master succeeds (total 2)
    const m1Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master 1',
        email: 'm1@salon.kg',
        password: 'Password123',
        isActive: true,
        isBookable: true,
      });
    expect(m1Res.status).toBe(201);
    const m1Id = (m1Res.body as { data: { id: string } }).data.id;

    // Creating a 2nd active master (total 3 > 2) -> 402 PLAN_LIMIT_REACHED
    const m2Fail = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master 2',
        email: 'm2@salon.kg',
        password: 'Password123',
        isActive: true,
        isBookable: true,
      });
    expect(m2Fail.status).toBe(402);
    expect((m2Fail.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT_REACHED');

    // Creating an INACTIVE master succeeds, then reactivating fails with 402 PLAN_LIMIT_REACHED
    const inactiveCreate = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Inactive Master', isActive: false, isBookable: false });
    expect(inactiveCreate.status).toBe(201);
    const inactiveId = (inactiveCreate.body as { data: { id: string } }).data.id;

    const reactivateFail = await request(app)
      .patch(`/api/v1/staff/${inactiveId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ isActive: true });
    expect(reactivateFail.status).toBe(402);
    expect((reactivateFail.body as { error: { code: string } }).error.code).toBe(
      'PLAN_LIMIT_REACHED',
    );

    // Delete m1 -> create another active m3 (total 2) -> try restoring m1 via email -> 402 PLAN_LIMIT_REACHED
    const delM1 = await request(app)
      .delete(`/api/v1/staff/${m1Id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(delM1.status).toBe(204);

    const m3Res = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Master 3', isActive: true, isBookable: true });
    expect(m3Res.status).toBe(201);

    const restoreFail = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Master 1 Restored',
        email: 'm1@salon.kg',
        password: 'Password123',
        isActive: true,
        isBookable: true,
      });
    expect(restoreFail.status).toBe(402);
    expect((restoreFail.body as { error: { code: string } }).error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('handles payment claims, single-pending constraint, confirm/reject idempotency, offline payment, and tenant isolation', async () => {
    const clock = new FakeClock(new Date('2026-11-01T10:00:00.000Z'));
    setClock(clock);

    const ownerA = await registerOwner('owner-a@salon.kg', 'Salon A');
    const ownerB = await registerOwner('owner-b@salon.kg', 'Salon B');
    const proPlan = await prisma.plan.findUniqueOrThrow({ where: { code: 'PRO' } });

    // Create claim
    const claimRes = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        planId: proPlan.id,
        months: 3,
        method: 'MBANK',
        reference: 'TXN-999',
      });
    expect(claimRes.status).toBe(201);
    const claimData = (claimRes.body as { data: { id: string; amount: string; status: string } })
      .data;
    expect(claimData.status).toBe(PaymentStatus.PENDING);
    expect(claimData.amount).toBe('11970.00'); // 3990.00 * 3

    // Second pending claim rejected -> 409 PAYMENT_CLAIM_PENDING
    const dupClaim = await request(app)
      .post('/api/v1/billing/payments')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ planId: proPlan.id, months: 1, method: 'CASH' });
    expect(dupClaim.status).toBe(409);
    expect((dupClaim.body as { error: { code: string } }).error.code).toBe('PAYMENT_CLAIM_PENDING');

    // Cross-tenant cancel -> 404 NOT_FOUND
    const crossCancel = await request(app)
      .delete(`/api/v1/billing/payments/${claimData.id}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(crossCancel.status).toBe(404);

    // Confirm payment (switches from BUSINESS trial -> PRO, remaining 14 days preserved!)
    const confirmed = await confirmPayment(claimData.id, null);
    expect(confirmed.status).toBe(PaymentStatus.CONFIRMED);

    // Double confirm -> 409 ALREADY_REVIEWED
    await expect(confirmPayment(claimData.id, null)).rejects.toMatchObject({
      code: 'ALREADY_REVIEWED',
      httpStatus: 409,
    });

    // Reject already confirmed -> 409 ALREADY_REVIEWED
    await expect(rejectPayment(claimData.id, null, 'Too late')).rejects.toMatchObject({
      code: 'ALREADY_REVIEWED',
      httpStatus: 409,
    });

    // Record offline payment
    const offline = await recordOfflinePayment(ownerA.company.id, null, {
      planId: proPlan.id,
      months: 1,
      method: PaymentMethod.CASH,
      reason: 'Cash received in office',
    });
    expect(offline.status).toBe(PaymentStatus.CONFIRMED);
  });

  it('syncs subscription status and enqueues deduplicated billing notifications via worker jobs', async () => {
    const clock = new FakeClock(new Date('2026-11-01T10:00:00.000Z'));
    setClock(clock);

    const owner = await registerOwner('worker-billing@salon.kg', 'Worker Salon');

    // Advance 12 days -> 2 days left (T-2 <= 3) -> T-3 notification enqueued once
    clock.advanceMs(12 * 86_400_000);
    const notif1 = await runBillingNotificationsOnce(clock.now());
    expect(notif1.enqueued).toBe(1);
    const notif1Dup = await runBillingNotificationsOnce(clock.now());
    expect(notif1Dup.enqueued).toBe(0); // deduped!

    // Advance to Nov 18 (17 days total -> LOCKED, since periodEnds Nov 15 + 3 grace = Nov 18)
    clock.advanceMs(5 * 86_400_000);
    const syncRes = await runBillingStateSyncOnce(clock.now());
    expect(syncRes.updated).toBe(1);

    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { companyId: owner.company.id },
    });
    expect(sub.status).toBe(SubscriptionStatus.LOCKED);

    const notifLocked = await runBillingNotificationsOnce(clock.now());
    expect(notifLocked.enqueued).toBe(1);
  });
});
