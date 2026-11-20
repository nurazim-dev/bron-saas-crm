import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { BusinessType, Role } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { prisma } from '../../src/lib/prisma.js';
import { truncateAllTables } from '../helpers/db.js';
import { createCompanyFactory, createUserFactory } from '../helpers/factories.js';

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

async function createSub(companyId: string, maxStaff = 5) {
  const plan = await prisma.plan.create({
    data: {
      code: `p23-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Onboarding Plan',
      priceMonthly: 1000,
      maxStaff,
      featureAnalytics: true,
      featureAutoReminders: false,
      featurePrepayment: false,
      isPublic: false,
      isActive: true,
    },
  });
  await prisma.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      isTrial: true,
      periodStartsAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate(),
      periodEndsAt: DateTime.fromISO('2026-12-01T00:00:00.000Z').toJSDate(),
      status: 'TRIAL',
    },
  });
}

describe('Phase 23: Onboarding & Presets (BR-21)', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p23-plan-' } } });
  });

  afterEach(async () => {
    resetClock();
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p23-plan-' } } });
  });

  it('computes onboarding steps from real data, returns presets by niche, and applies idempotently', async () => {
    setClock(new FakeClock('2026-11-20T10:00:00.000Z'));

    const company = await createCompanyFactory({
      businessType: BusinessType.BEAUTY_SALON,
      phone: null,
      address: null,
    });
    await createSub(company.id, 5);
    const owner = await createUserFactory(company.id, {
      role: Role.OWNER,
      isBookable: false,
    });
    const master = await createUserFactory(company.id, { role: Role.MASTER });

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

    // MASTER forbidden -> 403
    const masterRes = await request(app)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${masterToken}`);
    expect(masterRes.status).toBe(403);

    // Initial state: 0/4 steps
    const initRes = await request(app)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(initRes.status).toBe(200);
    const initState = asBody<
      DataEnvelope<{
        completedCount: number;
        showChecklist: boolean;
        steps: {
          profileComplete: boolean;
          hasServices: boolean;
          hasBookableMaster: boolean;
          linkShared: boolean;
        };
      }>
    >(initRes.body).data;
    expect(initState.completedCount).toBe(0);
    expect(initState.showChecklist).toBe(true);

    // Presets match BEAUTY_SALON
    const presetsRes = await request(app)
      .get('/api/v1/onboarding/presets')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(presetsRes.status).toBe(200);
    const presets = asBody<DataEnvelope<Array<{ id: string; businessType: string }>>>(
      presetsRes.body,
    ).data;
    expect(presets.length).toBeGreaterThanOrEqual(5);
    expect(presets.every((p) => p.businessType === 'BEAUTY_SALON')).toBe(true);

    // Apply onboarding (profile + 2 presets + owner serves clients + default hours)
    const apply1 = await request(app)
      .post('/api/v1/onboarding/apply')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        phone: '+996555111222',
        address: 'ул. Киевская 100',
        services: [
          { presetId: 'salon-womens-haircut', durationMin: 60, price: '1100.00' },
          { presetId: 'salon-manicure', durationMin: 90, price: '1200.00' },
        ],
        ownerServesClients: true,
        applyDefaultHours: true,
      });
    expect(apply1.status).toBe(200);
    const s1 = asBody<DataEnvelope<{ completedCount: number; isCompleted: boolean }>>(
      apply1.body,
    ).data;
    expect(s1.completedCount).toBe(3);
    expect(s1.isCompleted).toBe(false);

    // Apply again idempotently -> still 2 services, still 6 workingHours rows (Mon-Sat 10-20)
    const apply2 = await request(app)
      .post('/api/v1/onboarding/apply')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        services: [{ presetId: 'salon-womens-haircut', durationMin: 60, price: '1100.00' }],
        ownerServesClients: true,
        applyDefaultHours: true,
      });
    expect(apply2.status).toBe(200);
    expect(await prisma.service.count({ where: { companyId: company.id } })).toBe(2);
    expect(await prisma.workingHours.count({ where: { userId: owner.id } })).toBe(6);

    // Mark link-shared -> 4/4 completed!
    const shareRes = await request(app)
      .post('/api/v1/onboarding/link-shared')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(shareRes.status).toBe(200);
    const sDone = asBody<
      DataEnvelope<{ completedCount: number; isCompleted: boolean; showChecklist: boolean }>
    >(shareRes.body).data;
    expect(sDone.completedCount).toBe(4);
    expect(sDone.isCompleted).toBe(true);
    expect(sDone.showChecklist).toBe(false);
  });

  it('enforces plan maxStaff limit when adding firstMaster and supports dismiss', async () => {
    setClock(new FakeClock('2026-11-20T10:00:00.000Z'));

    const company = await createCompanyFactory();
    await createSub(company.id, 1); // Only owner fits
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: false });
    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    const limitRes = await request(app)
      .post('/api/v1/onboarding/apply')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        ownerServesClients: false,
        firstMaster: { name: 'Бектур' },
      });
    expect(limitRes.status).toBe(402);
    expect(asBody<ErrorEnvelope>(limitRes.body).error.code).toBe('PLAN_LIMIT_REACHED');

    const dismissRes = await request(app)
      .post('/api/v1/onboarding/dismiss')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(dismissRes.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ isDismissed: boolean; showChecklist: boolean }>>(dismissRes.body).data,
    ).toMatchObject({
      isDismissed: true,
      showChecklist: false,
    });
  });
});
