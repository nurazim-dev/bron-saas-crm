import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import {
  registerOwnerAndCompany,
  loginWithEmailPassword,
  refreshAuthSession,
  revokeUserSession,
  logoutAuthSession,
} from '../../src/modules/auth/auth.service.js';
import { truncateAllTables } from '../helpers/db.js';

const app = createApp();
const password = 'SessionPassword123!';
async function register(email = 'session@example.test') {
  return registerOwnerAndCompany({
    companyName: 'Session Salon',
    ownerName: 'Owner',
    businessType: 'BARBERSHOP',
    email,
    password,
    termsAccepted: true,
  });
}
describe('Server sessions', () => {
  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });
  it('rotates hashed refresh tokens and revokes the whole session on replay', async () => {
    const original = await register();
    const row = await prisma.authSession.findFirstOrThrow({
      where: { companyId: original.company.id, userId: original.user.id },
    });
    expect(row.refreshHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.refreshHash).not.toBe(original.refreshToken);
    const rotated = await refreshAuthSession(original.refreshToken);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(200);
    await expect(refreshAuthSession(original.refreshToken)).rejects.toMatchObject({
      httpStatus: 401,
    });
    await expect(refreshAuthSession(rotated.refreshToken)).rejects.toMatchObject({
      httpStatus: 401,
    });
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotated.accessToken}`)
      .expect(401);
  });
  it('logout invalidates the access and refresh token but preserves another device', async () => {
    const first = await register();
    const second = await loginWithEmailPassword(
      { email: first.user.email ?? '', password },
      'Second browser',
    );
    await logoutAuthSession(first.refreshToken);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(401);
    await expect(refreshAuthSession(first.refreshToken)).rejects.toMatchObject({ httpStatus: 401 });
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200);
  });
  it('never lists or revokes sessions of another user/company', async () => {
    const first = await register();
    const second = await register('other-session@example.test');
    const row = await prisma.authSession.findFirstOrThrow({
      where: { companyId: first.company.id },
    });
    await expect(
      revokeUserSession(second.user.id, second.company.id, row.id),
    ).rejects.toMatchObject({ httpStatus: 404 });
    const listing = await request(app)
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${first.accessToken}`);
    expect(listing.status).toBe(200);
    const data = listing.body as { data: { id: string; current: boolean; refreshHash?: string }[] };
    expect(data.data).toHaveLength(1);
    expect(data.data[0]).toMatchObject({ id: row.id, current: true });
    expect(data.data[0]).not.toHaveProperty('refreshHash');
    await revokeUserSession(first.user.id, first.company.id, row.id);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(401);
  });
});
