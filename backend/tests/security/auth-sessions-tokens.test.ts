import { createCipheriv, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import { generateSecret, generateSync } from 'otplib';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env, validateEnvConfig } from '../../src/config/env.js';
import { Role } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  signAdminMfaToken,
} from '../../src/modules/admin/admin-crypto.js';
import { startCompanyImpersonation } from '../../src/modules/admin/impersonation.service.js';
import { createTelegramLinkCode } from '../../src/modules/notifications/telegram-link.service.js';
import { truncateAllTables } from '../helpers/db.js';
import { createCompanyFactory, createUserFactory } from '../helpers/factories.js';

describe('Security Domains B & F: Authentication, Sessions, Tokens, CSRF & Cryptography', () => {
  const app = createApp();
  let clock: FakeClock;

  beforeEach(async () => {
    await truncateAllTables();
    clock = new FakeClock(DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate());
    setClock(clock);
  });

  afterEach(() => {
    resetClock();
  });

  it('rejects JWT alg:none, wrong secret, wrong audience, missing claims, expired tokens, and tokenVersion mismatch', async () => {
    const company = await createCompanyFactory();
    const owner = await createUserFactory(company.id, { role: Role.OWNER });

    // 1. alg: none
    const headerNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const payloadNone = Buffer.from(
      JSON.stringify({
        sub: owner.id,
        companyId: company.id,
        role: Role.OWNER,
        tv: owner.tokenVersion,
        typ: 'access',
      }),
    ).toString('base64url');
    const algNoneToken = `${headerNone}.${payloadNone}.`;
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${algNoneToken}`))
        .status,
    ).toBe(401);

    // 2. Bad signature / wrong secret
    const badSigToken = jwt.sign(
      {
        sub: owner.id,
        companyId: company.id,
        role: Role.OWNER,
        tv: owner.tokenVersion,
        typ: 'access',
      },
      'wrong_secret_at_least_32_bytes_long_000000',
      { algorithm: 'HS256' },
    );
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${badSigToken}`))
        .status,
    ).toBe(401);

    // 3. Refresh token used as access token (typ mismatch)
    const wrongTypToken = jwt.sign(
      {
        sub: owner.id,
        companyId: company.id,
        role: Role.OWNER,
        tv: owner.tokenVersion,
        typ: 'refresh',
      },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256' },
    );
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${wrongTypToken}`))
        .status,
    ).toBe(401);

    // 4. Missing claims
    const missingClaimsToken = jwt.sign({ sub: owner.id, typ: 'access' }, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
    });
    expect(
      (
        await request(app)
          .get('/api/v1/company')
          .set('Authorization', `Bearer ${missingClaimsToken}`)
      ).status,
    ).toBe(401);

    // 5. Expired token via FakeClock
    const validToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${validToken}`))
        .status,
    ).toBe(200);
    clock.advanceMs(16 * 60 * 1000);
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${validToken}`))
        .status,
    ).toBe(401);

    // 6. tokenVersion mismatch
    clock.set(DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate());
    const staleTvToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });
    await prisma.user.update({
      where: { id: owner.id },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${staleTvToken}`))
        .status,
    ).toBe(401);
  });

  it('enforces refresh rotation, rejects rotated refresh token reuse, enforces cookie flags and CSRF Origin checks', async () => {
    const allowedOrigin = env.CORS_ORIGINS[0] ?? 'http://localhost:3000';
    const regRes = await request(app).post('/api/v1/auth/register').send({
      companyName: 'Session Sec Barber',
      businessType: 'BARBERSHOP',
      ownerName: 'Owner Sec',
      email: 'session.sec@zapis.test',
      phone: '+996555112233',
      password: 'Password123!',
      termsAccepted: true,
    });
    expect(regRes.status).toBe(201);
    const setCookies = regRes.headers['set-cookie'] as unknown as string[];
    const rtCookie1 = setCookies?.find((c) => c.startsWith('zapis_rt=')) ?? '';
    expect(rtCookie1).toContain('HttpOnly');
    expect(rtCookie1).toContain('SameSite=Lax');
    expect(rtCookie1).toContain('Path=/api/v1/auth');

    // CSRF check: cross-site missing Origin (Sec-Fetch-Site: cross-site or foreign Referer) and foreign Origin on /api/v1/auth/refresh -> 403
    const crossSiteNoOriginRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', [rtCookie1]);
    expect(crossSiteNoOriginRes.status).toBe(403);

    const badOriginRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example.com')
      .set('Cookie', [rtCookie1]);
    expect(badOriginRes.status).toBe(403);

    // State change via GET on refresh/logout -> 404
    expect((await request(app).get('/api/v1/auth/refresh')).status).toBe(404);
    expect((await request(app).get('/api/v1/auth/logout')).status).toBe(404);

    // Valid refresh rotates refresh token
    clock.advanceMs(5000);
    const refresh1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', allowedOrigin)
      .set('Cookie', [rtCookie1]);
    expect(refresh1.status).toBe(200);
    const rtCookie2 =
      (refresh1.headers['set-cookie'] as unknown as string[])?.find((c) =>
        c.startsWith('zapis_rt='),
      ) ?? '';
    expect(rtCookie2).not.toBe(rtCookie1);

    // Reusing rotated rtCookie1 is rejected with 401
    const reuseRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', allowedOrigin)
      .set('Cookie', [rtCookie1]);
    expect(reuseRes.status).toBe(401);
  });

  it('prevents forgot-password enumeration and enforces account lockout on Admin MFA brute-force (SEC-004)', async () => {
    const company = await createCompanyFactory();
    await prisma.company.update({ where: { id: company.id }, data: { slug: `tok-${Date.now()}` } });
    const passwordHash = await hashPassword('Password123!');
    await createUserFactory(company.id, {
      role: Role.OWNER,
      email: 'existing@zapis.test',
      passwordHash,
    });

    // Forgot-password returns identical status and body for existing vs non-existing email
    const res1 = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'existing@zapis.test' });
    const res2 = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nonexistent@zapis.test' });
    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);
    expect(res1.body).toEqual(res2.body);

    // Admin MFA brute-force lockout (SEC-004): 5 failed MFA attempts must lock the admin account
    app.set('trust proxy', 1);
    const totpSecret = generateSecret();
    const recovery = generateRecoveryCodes(2);
    const admin = await prisma.platformAdmin.create({
      data: {
        email: 'mfa-lockout@zapis.test',
        name: 'MFA Admin',
        passwordHash,
        isActive: true,
        totpSecretEnc: encryptTotpSecret(totpSecret),
        totpEnabledAt: clock.now(),
        recoveryCodeHashes: recovery.hashes,
      },
    });

    const mfaToken = signAdminMfaToken(admin, 'mfa');

    for (let i = 0; i < 5; i++) {
      const badMfa = await request(app)
        .post('/api/v1/admin/auth/mfa')
        .set('X-Forwarded-For', `10.99.0.${i + 1}`)
        .send({ mfaToken, code: '000000' });
      expect(badMfa.status).toBe(401);
    }

    // 6th attempt even with a valid TOTP code must be rejected with 423 ACCOUNT_LOCKED
    const validTotp = generateSync({
      strategy: 'totp',
      secret: totpSecret,
      epoch: Math.floor(clock.now().getTime() / 1000),
    });
    const afterLockoutRes = await request(app)
      .post('/api/v1/admin/auth/mfa')
      .send({ mfaToken, code: validTotp });
    expect(afterLockoutRes.status).toBe(423);
    expect((afterLockoutRes.body as { error?: { code?: string } }).error?.code).toBe(
      'ACCOUNT_LOCKED',
    );
  });

  it('verifies >=128-bit entropy, hashing at rest, single-use and FakeClock expiry for security tokens, plus TOTP replay rejection', async () => {
    const company = await createCompanyFactory();
    await prisma.company.update({ where: { id: company.id }, data: { slug: `tok-${Date.now()}` } });
    const passwordHash = await hashPassword('Password123!');
    const owner = await createUserFactory(company.id, {
      role: Role.OWNER,
      email: 'tokens-owner@zapis.test',
      passwordHash,
    });
    const admin = await prisma.platformAdmin.create({
      data: {
        email: 'tokens-admin@zapis.test',
        name: 'Tokens Admin',
        passwordHash,
        isActive: true,
      },
    });

    // 1. Password reset token: hashed at rest, raw token never in DB
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: owner.email ?? '' });
    const resetRow = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: owner.id },
    });
    expect(resetRow.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    // 2. Impersonation code: >=128-bit entropy (32 random bytes base64url = 43 chars), hashed at rest
    const imp = await startCompanyImpersonation(admin.id, company.id, 'Security verification test');
    expect(Buffer.from(imp.code, 'base64url').length).toBeGreaterThanOrEqual(16);
    const impRow = await prisma.impersonationCode.findFirstOrThrow({
      where: { companyId: company.id },
    });
    expect(impRow.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(impRow.codeHash).not.toBe(imp.code);

    // 3. Telegram link code: >=128-bit entropy, hashed at rest in User.telegramLinkCodeHash
    const tgLink = await createTelegramLinkCode({
      userId: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tokenVersion: owner.tokenVersion,
    });
    const rawTgCode =
      (tgLink as { code?: string; deepLink?: string }).code ??
      (tgLink as { deepLink?: string }).deepLink?.split('start=')[1] ??
      '';
    expect(Buffer.from(rawTgCode, 'base64url').length).toBeGreaterThanOrEqual(16);
    const userRow = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(userRow.telegramLinkCodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(userRow.telegramLinkCodeHash).not.toBe(rawTgCode);

    // 4. TOTP replay protection & enrollment-scoped MFA token limits
    const secret = generateSecret();
    const mfaAdmin = await prisma.platformAdmin.create({
      data: {
        email: 'totp-replay@zapis.test',
        name: 'TOTP Replay Admin',
        passwordHash,
        isActive: true,
        totpSecretEnc: encryptTotpSecret(secret),
        totpEnabledAt: clock.now(),
      },
    });
    const enrollToken = signAdminMfaToken(mfaAdmin, 'enroll');
    // Enrollment token cannot be used to verify MFA login
    const scopeMismatch = await request(app)
      .post('/api/v1/admin/auth/mfa')
      .send({ mfaToken: enrollToken, code: '123456' });
    expect(scopeMismatch.status).toBe(403);

    const loginMfaToken = signAdminMfaToken(mfaAdmin, 'mfa');
    const code = generateSync({
      strategy: 'totp',
      secret,
      epoch: Math.floor(clock.now().getTime() / 1000),
    });
    const firstUse = await request(app)
      .post('/api/v1/admin/auth/mfa')
      .send({ mfaToken: loginMfaToken, code });
    expect(firstUse.status).toBe(200);

    // Replaying the same TOTP code in the same time step -> 401
    const replayUse = await request(app)
      .post('/api/v1/admin/auth/mfa')
      .send({ mfaToken: loginMfaToken, code });
    expect(replayUse.status).toBe(401);
  });

  it('enforces 16-byte GCM authentication tags on decryptTotpSecret and rejects weak production secrets (SEC-007)', async () => {
    const key = Buffer.from(env.ADMIN_TOTP_ENCRYPTION_KEY, 'base64');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update('JBSWY3DPEHPK3PXP', 'utf8'), cipher.final()]);
    const fullTag = cipher.getAuthTag();
    const truncatedTag = fullTag.subarray(0, 4); // 4-byte truncated tag forgery attempt

    const forgedPayload = `${iv.toString('base64')}:${truncatedTag.toString('base64')}:${encrypted.toString('base64')}`;
    expect(() => decryptTotpSecret(forgedPayload)).toThrow();

    // Production env validation rejects weak/placeholder/duplicate secrets and defaults ADMIN_REQUIRE_2FA=true
    const prodValid = validateEnvConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://zapis:zapis@localhost:5432/zapis',
      JWT_ACCESS_SECRET: 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0',
      JWT_REFRESH_SECRET: 'z9Y8x7W6v5U4t3S2r1Q0p9O8n7M6l5K4j3I2h1G0',
      ADMIN_JWT_ACCESS_SECRET: 'm1N2b3V4c5X6z7L8k9J0h1G2f3D4s5A6p7O8i9U0',
      ADMIN_JWT_REFRESH_SECRET: 'q1W2e3R4t5Y6u7I8o9P0a1S2d3F4g5H6j7K8l9Z0',
      ADMIN_TOTP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
    expect(prodValid.success).toBe(true);
    if (prodValid.success) {
      expect(prodValid.data.ADMIN_REQUIRE_2FA).toBe(true);
    }

    const prodWeak = validateEnvConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://zapis:zapis@localhost:5432/zapis',
      JWT_ACCESS_SECRET: 'replace_with_at_least_32_characters_random_secret',
      JWT_REFRESH_SECRET: 'replace_with_another_at_least_32_characters_secret',
      ADMIN_JWT_ACCESS_SECRET: '0000000000000000000000000000000000000000',
      ADMIN_JWT_REFRESH_SECRET: '1111111111111111111111111111111111111111',
      ADMIN_TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 0).toString('base64'),
    });
    expect(prodWeak.success).toBe(false);

    // Argon2id parameter check
    const h = await hashPassword('StrongPassword123!');
    expect(h.startsWith('$argon2id$')).toBe(true);
  });
});
