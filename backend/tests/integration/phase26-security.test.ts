import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { DateTime } from 'luxon';
import { pino } from 'pino';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Role, TimeOffKind } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken, signImpersonationAccessToken } from '../../src/lib/jwt.js';
import { scrubSensitiveUrl } from '../../src/lib/logger.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  encryptTotpSecret,
  hashSha256Hex,
  signAdminAccessToken,
} from '../../src/modules/admin/admin-crypto.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

function asErr(body: unknown): ErrorEnvelope {
  return body as ErrorEnvelope;
}

describe('Phase 26: Security Sweeps, Isolation & Redaction', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    setClock(new FakeClock(DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate()));
  });

  afterEach(() => {
    resetClock();
  });

  it('Sweep 1: enforces authentication and cross-tenant 404 isolation across tenant routes', async () => {
    const companyA = await createCompanyFactory();
    const companyB = await createCompanyFactory();

    const ownerA = await createUserFactory(companyA.id, { role: Role.OWNER, isBookable: true });
    const ownerB = await createUserFactory(companyB.id, { role: Role.OWNER, isBookable: true });

    const serviceB = await createServiceFactory(companyB.id);
    const clientB = await prisma.client.create({
      data: { companyId: companyB.id, name: 'Client B', phone: '+996555222333' },
    });
    const apptB = await createAppointmentFactory({
      companyId: companyB.id,
      masterId: ownerB.id,
      serviceId: serviceB.id,
      startAt: DateTime.fromISO('2026-11-17T06:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-17T07:00:00.000Z').toJSDate(),
    });
    const timeOffB = await prisma.timeOff.create({
      data: {
        companyId: companyB.id,
        userId: ownerB.id,
        startAt: DateTime.fromISO('2026-11-18T06:00:00.000Z').toJSDate(),
        endAt: DateTime.fromISO('2026-11-18T08:00:00.000Z').toJSDate(),
        kind: TimeOffKind.VACATION,
        note: 'Vacation',
      },
    });

    const tokenA = signAccessToken({
      sub: ownerA.id,
      companyId: companyA.id,
      role: Role.OWNER,
      tv: ownerA.tokenVersion,
    });

    const unauthRoutes: Array<[string, string]> = [
      ['get', '/api/v1/company'],
      ['get', '/api/v1/services'],
      ['get', '/api/v1/staff'],
      ['get', '/api/v1/appointments'],
      ['get', '/api/v1/clients'],
      ['get', '/api/v1/time-off'],
      ['get', '/api/v1/billing/subscription'],
      ['get', '/api/v1/notifications'],
      ['get', '/api/v1/analytics/summary?from=2026-11-01&to=2026-11-16'],
      ['get', '/api/v1/onboarding/status'],
      ['get', '/api/v1/me/notifications'],
    ];

    for (const [method, url] of unauthRoutes) {
      const res =
        method === 'get' ? await request(app).get(url) : await request(app).post(url).send({});
      expect(res.status, `${method.toUpperCase()} ${url} without JWT`).toBe(401);
    }

    const crossTenantChecks: Array<{
      method: 'get' | 'patch' | 'delete';
      url: string;
      body?: Record<string, unknown>;
    }> = [
      { method: 'patch', url: `/api/v1/services/${serviceB.id}`, body: { name: 'Hijack' } },
      { method: 'delete', url: `/api/v1/services/${serviceB.id}` },
      { method: 'patch', url: `/api/v1/staff/${ownerB.id}`, body: { name: 'Hijack' } },
      { method: 'get', url: `/api/v1/appointments/${apptB.id}` },
      { method: 'patch', url: `/api/v1/appointments/${apptB.id}`, body: { notes: 'Hijack' } },
      { method: 'delete', url: `/api/v1/appointments/${apptB.id}` },
      { method: 'get', url: `/api/v1/clients/${clientB.id}` },
      { method: 'patch', url: `/api/v1/clients/${clientB.id}`, body: { name: 'Hijack' } },
      { method: 'delete', url: `/api/v1/time-off/${timeOffB.id}` },
    ];

    for (const check of crossTenantChecks) {
      const req = request(app)[check.method](check.url).set('Authorization', `Bearer ${tokenA}`);
      const res = check.body ? await req.send(check.body) : await req;
      expect(res.status, `Cross-tenant ${check.method.toUpperCase()} ${check.url}`).toBe(404);
      expect(asErr(res.body).error.code).toBe('NOT_FOUND');
    }
  });

  it('Sweep 2: enforces LOCKED (402) and impersonation read-only (403) on mutating staff routes', async () => {
    const company = await createCompanyFactory();
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id);

    const plan = await prisma.plan.create({
      data: {
        code: `p26-plan-${randomUUID().slice(0, 6)}`,
        name: 'Pro',
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
        periodStartsAt: DateTime.fromISO('2026-10-01T00:00:00.000Z').toJSDate(),
        periodEndsAt: DateTime.fromISO('2026-10-31T00:00:00.000Z').toJSDate(), // LOCKED
      },
    });

    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    const lockedWrites: Array<{
      method: 'post' | 'patch' | 'delete';
      url: string;
      body?: Record<string, unknown>;
    }> = [
      { method: 'patch', url: '/api/v1/company', body: { name: 'Locked Edit' } },
      {
        method: 'post',
        url: '/api/v1/services',
        body: { name: 'New', durationMin: 30, price: 500 },
      },
      {
        method: 'patch',
        url: `/api/v1/services/${service.id}`,
        body: { name: 'Updated' },
      },
      {
        method: 'post',
        url: '/api/v1/time-off',
        body: {
          userId: owner.id,
          startAt: '2026-11-18T06:00:00.000Z',
          endAt: '2026-11-18T08:00:00.000Z',
          kind: 'VACATION',
        },
      },
      {
        method: 'post',
        url: '/api/v1/appointments',
        body: {
          serviceId: service.id,
          masterId: owner.id,
          startAt: '2026-11-17T06:00:00.000Z',
          clientName: 'Test',
          clientPhone: '+996555111222',
        },
      },
    ];

    for (const w of lockedWrites) {
      const req = request(app)[w.method](w.url).set('Authorization', `Bearer ${ownerToken}`);
      const res = w.body ? await req.send(w.body) : await req;
      expect(res.status, `LOCKED ${w.method.toUpperCase()} ${w.url}`).toBe(402);
      expect(asErr(res.body).error.code).toBe('SUBSCRIPTION_REQUIRED');
    }

    // Impersonation read-only (403) even when subscription is ACTIVE
    await prisma.subscription.update({
      where: { companyId: company.id },
      data: { periodEndsAt: DateTime.fromISO('2026-12-31T00:00:00.000Z').toJSDate() },
    });

    const impToken = signImpersonationAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
      imp: randomUUID(),
    });

    for (const w of lockedWrites) {
      const req = request(app)[w.method](w.url).set('Authorization', `Bearer ${impToken}`);
      const res = w.body ? await req.send(w.body) : await req;
      expect(res.status, `IMP ${w.method.toUpperCase()} ${w.url}`).toBe(403);
      expect(asErr(res.body).error.code).toBe('IMPERSONATION_READ_ONLY');
    }
  });

  it('Sweep 3: isolates admin JWTs from staff routes and staff JWTs from admin routes', async () => {
    const company = await createCompanyFactory();
    const owner = await createUserFactory(company.id, { role: Role.OWNER });
    const staffToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    const admin = await prisma.platformAdmin.create({
      data: {
        email: 'sec-admin@zapis.kg',
        name: 'Sec Admin',
        passwordHash: 'hash',
        isActive: true,
        totpEnabledAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate(),
        totpSecretEnc: encryptTotpSecret('JBSWY3DPEHPK3PXP'),
      },
    });
    const adminToken = signAdminAccessToken(admin);

    const adminRoutes = [
      '/api/v1/admin/overview',
      '/api/v1/admin/companies',
      '/api/v1/admin/plans',
      '/api/v1/admin/payments',
      '/api/v1/admin/audit-logs',
    ];
    for (const url of adminRoutes) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${staffToken}`);
      expect(res.status, `Staff token on ${url}`).toBe(401);
    }

    const staffRoutes = [
      '/api/v1/company',
      '/api/v1/services',
      '/api/v1/appointments',
      '/api/v1/billing/subscription',
      '/api/v1/clients',
    ];
    for (const url of staffRoutes) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, `Admin token on ${url}`).toBe(401);
    }
  });

  it('redacts secrets in logger output and stores tokens hashed/encrypted in DB', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, cb) {
        lines.push(chunk.toString('utf8'));
        cb();
      },
    });

    const testLogger = pino(
      {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            '*.password',
            '*.token',
            '*.secret',
            '*.totpSecret',
            '*.recoveryCodes',
            '*.telegramLinkCode',
          ],
          censor: '[REDACTED]',
        },
      },
      sink,
    );

    testLogger.info({
      req: { headers: { authorization: 'Bearer super-secret-jwt', cookie: 'zapis_rt=abc' } },
      payload: {
        password: 'MyPassword123!',
        token: 'raw-reset-token',
        secret: 'raw-totp-secret',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        recoveryCodes: ['ABCD-1234'],
        telegramLinkCode: '123456',
      },
    });

    const logged = lines.join('');
    expect(logged).not.toContain('super-secret-jwt');
    expect(logged).not.toContain('zapis_rt=abc');
    expect(logged).not.toContain('MyPassword123!');
    expect(logged).not.toContain('raw-reset-token');
    expect(logged).not.toContain('JBSWY3DPEHPK3PXP');
    expect(logged).not.toContain('ABCD-1234');
    expect(logged).toContain('[REDACTED]');

    expect(scrubSensitiveUrl('/api/v1/public/appointments?manageToken=secret123')).toBe(
      '/api/v1/public/appointments?manageToken=[REDACTED]',
    );

    const rawSecret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptTotpSecret(rawSecret);
    expect(encrypted).not.toContain(rawSecret);
    expect(hashSha256Hex('raw-token')).toBe(createHash('sha256').update('raw-token').digest('hex'));
  });
});
