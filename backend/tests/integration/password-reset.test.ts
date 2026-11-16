import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { scrubSensitiveUrl } from '../../src/lib/logger.js';
import { prisma, prismaUnfiltered } from '../../src/lib/prisma.js';
import { resetProviderRegistry, setProviderRegistry } from '../../src/lib/registry.js';
import {
  resetForgotPasswordEmailRateLimitForTest,
  resetRateLimitersForTest,
} from '../../src/middleware/rate-limit.js';
import { hashPasswordResetToken } from '../../src/modules/auth/password-reset.service.js';
import { runOutboxDispatcherOnce } from '../../src/modules/notifications/dispatcher.service.js';
import type {
  ClientMessageProvider,
  EmailProvider,
  EmailSendParams,
  TelegramProvider,
} from '../../src/modules/notifications/providers/types.js';
import { truncateAllTables } from '../helpers/db.js';

class CapturingEmailProvider implements EmailProvider {
  readonly sent: EmailSendParams[] = [];

  send(params: EmailSendParams): Promise<void> {
    this.sent.push(params);
    return Promise.resolve();
  }
}

class NoopTelegramProvider implements TelegramProvider {
  send(): Promise<void> {
    return Promise.resolve();
  }
}

class NoopClientProvider implements ClientMessageProvider {
  readonly name = 'noop';
  readonly isConfigured = false;
  send(): Promise<void> {
    return Promise.resolve();
  }
}

function extractTokenFromEmail(email: EmailSendParams | undefined): string {
  if (!email) {
    throw new Error('Expected email to have been sent');
  }
  const match = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(email.text);
  if (!match?.[1]) {
    throw new Error(`Could not find reset token in email text: ${email.text}`);
  }
  return match[1];
}

describe('Password recovery (Phase 13 / BR-13)', () => {
  const app = createApp();
  let emailProvider: CapturingEmailProvider;

  beforeEach(async () => {
    await truncateAllTables();
    resetRateLimitersForTest();
    emailProvider = new CapturingEmailProvider();
    setProviderRegistry({
      email: emailProvider,
      telegram: new NoopTelegramProvider(),
      clientMessage: new NoopClientProvider(),
    });
  });

  afterEach(() => {
    resetClock();
    resetProviderRegistry();
  });

  async function registerTestOwner(email = 'owner@salon.kg', companyName = 'Salon Test') {
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
          company: { id: string };
        };
      }
    ).data;
  }

  it('returns identical 202 body for existing, missing, inactive, soft-deleted, and deleted-company accounts', async () => {
    const active = await registerTestOwner('active@salon.kg', 'Active Salon');
    const inactiveOwner = await registerTestOwner('inactive@salon.kg', 'Inactive Salon');
    const deletedUserOwner = await registerTestOwner('deleted-user@salon.kg', 'Deleted User Salon');
    const deletedCompanyOwner = await registerTestOwner(
      'deleted-co@salon.kg',
      'Deleted Company Salon',
    );

    await prismaUnfiltered.user.update({
      where: { id: inactiveOwner.user.id },
      data: { isActive: false },
    });
    await prismaUnfiltered.user.update({
      where: { id: deletedUserOwner.user.id },
      data: { deletedAt: new Date('2026-11-16T01:00:00.000Z') },
    });
    await prismaUnfiltered.company.update({
      where: { id: deletedCompanyOwner.company.id },
      data: { deletedAt: new Date('2026-11-16T01:00:00.000Z') },
    });

    const emails = [
      active.user.email,
      'missing@salon.kg',
      'inactive@salon.kg',
      'deleted-user@salon.kg',
      'deleted-co@salon.kg',
    ];

    const bodies: unknown[] = [];
    for (const email of emails) {
      resetRateLimitersForTest();
      resetForgotPasswordEmailRateLimitForTest(email);
      const res = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      expect(res.status).toBe(202);
      bodies.push(res.body);
    }

    for (const body of bodies) {
      expect(body).toEqual(bodies[0]);
    }

    // Only the active user got a token & outbox email
    const tokens = await prisma.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.userId).toBe(active.user.id);

    const outboxCount = await prisma.outboxMessage.count();
    expect(outboxCount).toBe(1);
  });

  it('enforces 3/hour/email and 5/hour/IP rate limits on forgot-password', async () => {
    const email = 'ratelimit@salon.kg';
    resetForgotPasswordEmailRateLimitForTest(email);

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      expect(res.status).toBe(202);
    }

    const emailBlocked = await request(app).post('/api/v1/auth/forgot-password').send({ email });
    expect(emailBlocked.status).toBe(429);
    expect((emailBlocked.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');

    // Now test 5/hour/IP across distinct emails
    resetRateLimitersForTest();
    for (let i = 0; i < 5; i++) {
      const uniqueEmail = `ip-limit-${i}@salon.kg`;
      resetForgotPasswordEmailRateLimitForTest(uniqueEmail);
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: uniqueEmail });
      expect(res.status).toBe(202);
    }

    const ipBlocked = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ip-limit-6@salon.kg' });
    expect(ipBlocked.status).toBe(429);
  });

  it('stores only SHA-256 hash, validates without consuming, enforces single use, kills sessions, and audits', async () => {
    const clock = new FakeClock(new Date('2026-11-16T10:00:00.000Z'));
    setClock(clock);

    const owner = await registerTestOwner('reset-flow@salon.kg', 'Reset Flow Salon');
    resetForgotPasswordEmailRateLimitForTest(owner.user.email);

    const forgotRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: owner.user.email });
    expect(forgotRes.status).toBe(202);

    await runOutboxDispatcherOnce();
    const rawToken = extractTokenFromEmail(emailProvider.sent[0]);

    // DB stores SHA-256 hash, never raw token
    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: owner.user.id },
    });
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(stored.tokenHash).toBe(hashPasswordResetToken(rawToken));

    // Validate does not consume
    const validate1 = await request(app).get(
      `/api/v1/auth/reset-password/validate?token=${encodeURIComponent(rawToken)}`,
    );
    expect(validate1.status).toBe(200);
    expect((validate1.body as { data: { valid: boolean } }).data.valid).toBe(true);

    // Password policy enforced
    const weakRes = await request(app).post('/api/v1/auth/reset-password').send({
      token: rawToken,
      newPassword: 'short',
    });
    expect(weakRes.status).toBe(400);
    expect((weakRes.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');

    // Reset succeeds (204)
    const resetRes = await request(app).post('/api/v1/auth/reset-password').send({
      token: rawToken,
      newPassword: 'NewStrongPassword123',
    });
    expect(resetRes.status).toBe(204);

    // Validate & reuse after reset fail
    const validateAfter = await request(app).get(
      `/api/v1/auth/reset-password/validate?token=${encodeURIComponent(rawToken)}`,
    );
    expect((validateAfter.body as { data: { valid: boolean } }).data.valid).toBe(false);

    const reuseRes = await request(app).post('/api/v1/auth/reset-password').send({
      token: rawToken,
      newPassword: 'AnotherPassword123',
    });
    expect(reuseRes.status).toBe(400);
    expect((reuseRes.body as { error: { code: string } }).error.code).toBe(
      'INVALID_OR_EXPIRED_TOKEN',
    );

    // Old access token is dead (tokenVersion incremented)
    const meOldRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(meOldRes.status).toBe(401);

    // Old password fails, new password works
    const oldLogin = await request(app).post('/api/v1/auth/login').send({
      email: owner.user.email,
      password: 'Password123',
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/v1/auth/login').send({
      email: owner.user.email,
      password: 'NewStrongPassword123',
    });
    expect(newLogin.status).toBe(200);

    // Audit entries recorded
    const audits = await prisma.auditLog.findMany({
      where: { companyId: owner.company.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual([
      'auth.password_reset_request',
      'auth.password_reset_complete',
    ]);
  });

  it('expires tokens after 60 minutes via FakeClock and second token invalidates first', async () => {
    const clock = new FakeClock(new Date('2026-11-16T10:00:00.000Z'));
    setClock(clock);

    const owner = await registerTestOwner('expiry@salon.kg', 'Expiry Salon');
    resetForgotPasswordEmailRateLimitForTest(owner.user.email);

    await request(app).post('/api/v1/auth/forgot-password').send({ email: owner.user.email });
    await runOutboxDispatcherOnce();
    const firstToken = extractTokenFromEmail(emailProvider.sent[0]);

    // Second request invalidates first token
    await request(app).post('/api/v1/auth/forgot-password').send({ email: owner.user.email });
    await runOutboxDispatcherOnce();
    const secondToken = extractTokenFromEmail(emailProvider.sent[1]);

    const validateFirst = await request(app).get(
      `/api/v1/auth/reset-password/validate?token=${encodeURIComponent(firstToken)}`,
    );
    expect((validateFirst.body as { data: { valid: boolean } }).data.valid).toBe(false);

    const validateSecond = await request(app).get(
      `/api/v1/auth/reset-password/validate?token=${encodeURIComponent(secondToken)}`,
    );
    expect((validateSecond.body as { data: { valid: boolean } }).data.valid).toBe(true);

    // Advance 61 minutes -> second token expires
    clock.advanceMs(61 * 60_000);

    const validateExpired = await request(app).get(
      `/api/v1/auth/reset-password/validate?token=${encodeURIComponent(secondToken)}`,
    );
    expect((validateExpired.body as { data: { valid: boolean } }).data.valid).toBe(false);

    const resetExpired = await request(app).post('/api/v1/auth/reset-password').send({
      token: secondToken,
      newPassword: 'ExpiredTestPassword123',
    });
    expect(resetExpired.status).toBe(400);
    expect((resetExpired.body as { error: { code: string } }).error.code).toBe(
      'INVALID_OR_EXPIRED_TOKEN',
    );
  });

  it('supports owner-generated reset link for same-company MASTER and enforces RBAC and tenant isolation', async () => {
    const ownerA = await registerTestOwner('owner-a@salon.kg', 'Salon A');
    const ownerB = await registerTestOwner('owner-b@salon.kg', 'Salon B');

    // Create a MASTER with login in Salon A
    const staffCreate = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        name: 'Master With Login',
        email: 'master-a@salon.kg',
        password: 'MasterPassword123',
        isActive: true,
        isBookable: true,
      });
    expect(staffCreate.status).toBe(201);
    const masterId = (staffCreate.body as { data: { id: string } }).data.id;

    // Create a MASTER without login in Salon A
    const noLoginCreate = await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({
        name: 'Master No Login',
        isActive: true,
        isBookable: true,
      });
    expect(noLoginCreate.status).toBe(201);
    const noLoginMasterId = (noLoginCreate.body as { data: { id: string } }).data.id;

    // Cross-tenant access returns 404 NOT_FOUND
    const crossTenantRes = await request(app)
      .post(`/api/v1/staff/${masterId}/password-reset-link`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({});
    expect(crossTenantRes.status).toBe(404);

    // Master without login returns 404 NOT_FOUND
    const noLoginRes = await request(app)
      .post(`/api/v1/staff/${noLoginMasterId}/password-reset-link`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({});
    expect(noLoginRes.status).toBe(404);

    // MASTER role cannot call endpoint -> 403 FORBIDDEN
    const masterLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'master-a@salon.kg',
      password: 'MasterPassword123',
    });
    expect(masterLogin.status).toBe(200);
    const masterToken = (masterLogin.body as { data: { accessToken: string } }).data.accessToken;

    const forbiddenRes = await request(app)
      .post(`/api/v1/staff/${masterId}/password-reset-link`)
      .set('Authorization', `Bearer ${masterToken}`)
      .send({});
    expect(forbiddenRes.status).toBe(403);

    // OWNER generates link with sendEmail: true
    const linkRes = await request(app)
      .post(`/api/v1/staff/${masterId}/password-reset-link`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ sendEmail: true });
    expect(linkRes.status).toBe(200);
    const linkData = (linkRes.body as { data: { url: string; expiresAt: string } }).data;
    expect(linkData.url).toContain('/reset-password?token=');
    expect(linkData.expiresAt).toMatch(/Z$/);

    await runOutboxDispatcherOnce();
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0]?.to).toBe('master-a@salon.kg');

    // Use the generated token to reset master password
    const parsedUrl = new URL(linkData.url);
    const rawToken = parsedUrl.searchParams.get('token') ?? '';
    expect(rawToken.length).toBeGreaterThan(20);

    const resetRes = await request(app).post('/api/v1/auth/reset-password').send({
      token: rawToken,
      newPassword: 'MasterNewPassword123',
    });
    expect(resetRes.status).toBe(204);

    const newMasterLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'master-a@salon.kg',
      password: 'MasterNewPassword123',
    });
    expect(newMasterLogin.status).toBe(200);
  });

  it('scrubs reset tokens from logged URLs', () => {
    const scrubbed = scrubSensitiveUrl(
      '/api/v1/auth/reset-password/validate?token=super-secret-token-123&foo=bar',
    );
    expect(scrubbed).toBe('/api/v1/auth/reset-password/validate?token=[REDACTED]&foo=bar');
    expect(scrubbed).not.toContain('super-secret-token-123');
  });
});
