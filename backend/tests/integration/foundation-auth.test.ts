import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import * as auditModule from '../../src/lib/audit.js';
import { signAccessToken, signRefreshToken, REFRESH_COOKIE_NAME } from '../../src/lib/jwt.js';
import * as passwords from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import {
  changeUserPassword,
  registerOwnerAndCompany,
} from '../../src/modules/auth/auth.service.js';
import { truncateAllTables } from '../helpers/db.js';

const app = createApp();
const register = (email: string) =>
  registerOwnerAndCompany({
    companyName: 'Foundation Salon',
    businessType: 'BEAUTY_SALON',
    ownerName: 'Owner',
    email,
    password: 'OriginalPassword123!',
    termsAccepted: true,
  });

describe('Foundation authentication boundaries', () => {
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });
  afterEach(() => vi.restoreAllMocks());

  it('rejects access and refresh claims combining one user with another company', async () => {
    const a = await register('foundation-a@example.test');
    const b = await register('foundation-b@example.test');
    const claims = { sub: a.user.id, companyId: b.company.id, role: a.user.role, tv: 0 };
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signAccessToken(claims)}`)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${signRefreshToken(claims)}`)
      .expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
  });

  it('allows only one concurrent password change and records exactly one audit event', async () => {
    const session = await register('foundation-race@example.test');
    const realHash = passwords.hashPassword;
    let arrived = 0;
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(passwords, 'hashPassword').mockImplementation(async (value) => {
      const hash = await realHash(value);
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      return hash;
    });
    const candidates = ['ChangedPassword123!', 'OtherPassword456!'];
    const results = await Promise.allSettled(
      candidates.map((newPassword) =>
        changeUserPassword(session.user.id, session.company.id, {
          currentPassword: 'OriginalPassword123!',
          newPassword,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'UNAUTHENTICATED', httpStatus: 401 },
    });
    const user = await prisma.user.findFirstOrThrow({
      where: { id: session.user.id, companyId: session.company.id },
    });
    expect(user.tokenVersion).toBe(1);
    const winner = candidates[results.findIndex((result) => result.status === 'fulfilled')];
    expect(winner).toBeDefined();
    if (!user.passwordHash || !winner) throw new Error('Missing password change result');
    expect(await passwords.verifyPassword(user.passwordHash, winner)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { companyId: session.company.id, action: 'auth.password_change' },
      }),
    ).toBe(1);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${session.refreshToken}`)
      .expect(401);
  });

  it('rolls back the password and token version when audit persistence fails', async () => {
    const session = await register('foundation-audit@example.test');
    vi.spyOn(auditModule, 'audit').mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(
      changeUserPassword(session.user.id, session.company.id, {
        currentPassword: 'OriginalPassword123!',
        newPassword: 'ChangedPassword123!',
      }),
    ).rejects.toThrow('Audit unavailable');
    const user = await prisma.user.findFirstOrThrow({
      where: { id: session.user.id, companyId: session.company.id },
    });
    expect(user.tokenVersion).toBe(0);
    if (!user.passwordHash) throw new Error('Missing original password');
    expect(await passwords.verifyPassword(user.passwordHash, 'OriginalPassword123!')).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { companyId: session.company.id, action: 'auth.password_change' },
      }),
    ).toBe(0);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
  });
});
