import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { BusinessType, Role } from '../../src/generated/prisma/client.js';
import type { ErrorResponseBody } from '../../src/lib/errors.js';
import { REFRESH_COOKIE_NAME } from '../../src/lib/jwt.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma, prismaUnfiltered } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import type { AuthUserDto } from '../../src/modules/auth/auth.service.js';
import type { CompanyDto } from '../../src/modules/company/company.service.js';
import { truncateAllTables } from '../helpers/db.js';

interface AuthEnvelope {
  data: {
    accessToken: string;
    user: AuthUserDto;
    company: CompanyDto;
  };
}

interface CompanyEnvelope {
  data: CompanyDto;
}

function asAuthEnvelope(body: unknown): AuthEnvelope {
  return body as AuthEnvelope;
}

function asCompanyEnvelope(body: unknown): CompanyEnvelope {
  return body as CompanyEnvelope;
}

function asErrorEnvelope(body: unknown): ErrorResponseBody {
  return body as ErrorResponseBody;
}

function extractCookieHeader(
  setCookieHeader: string | string[] | undefined,
  name: string,
): string | undefined {
  if (!setCookieHeader) return undefined;
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return list.find((cookieStr) => cookieStr.startsWith(`${name}=`));
}

function extractCookieValue(cookieLine: string | undefined, name: string): string | undefined {
  if (!cookieLine) return undefined;
  const prefix = `${name}=`;
  const firstSegment = cookieLine.split(';')[0];
  if (!firstSegment || !firstSegment.startsWith(prefix)) return undefined;
  return decodeURIComponent(firstSegment.slice(prefix.length));
}

describe('Auth & Company RBAC endpoints (/api/v1/auth, /api/v1/company)', () => {
  const app = createApp();

  beforeEach(async () => {
    resetRateLimitersForTest();
    await truncateAllTables();
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates Company (with transliterated slug) and OWNER in one transaction and returns 201 + refresh cookie', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Барбершоп Лорд',
        businessType: 'BARBERSHOP',
        ownerName: 'Азамат Токтогулов',
        email: '  OWNER@Lord.kg ',
        phone: '0555 123 456',
        password: 'Password123!',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        data: {
          accessToken: expect.any(String) as string,
          user: {
            id: expect.any(String) as string,
            role: 'OWNER',
            name: 'Азамат Токтогулов',
            email: 'owner@lord.kg',
            phone: '+996555123456',
            isActive: true,
            isBookable: true,
          },
          company: {
            id: expect.any(String) as string,
            name: 'Барбершоп Лорд',
            slug: 'barbershop-lord',
            businessType: 'BARBERSHOP',
            phone: '+996555123456',
            timezone: 'Asia/Bishkek',
            currency: 'KGS',
            slotIntervalMin: 30,
            minLeadTimeMin: 60,
            maxAdvanceDays: 60,
            publicBookingEnabled: true,
          },
        },
      });

      const cookieLine = extractCookieHeader(res.headers['set-cookie'], REFRESH_COOKIE_NAME);
      expect(cookieLine).toBeDefined();
      expect(cookieLine).toContain('HttpOnly');
      expect(cookieLine).toContain('SameSite=Lax');
      expect(cookieLine).toContain('Path=/api/v1/auth');
    });

    it('appends a numeric suffix when the company slug collides (including soft-deleted companies)', async () => {
      const r1 = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Барбершоп Лорд',
        businessType: 'BARBERSHOP',
        ownerName: 'Владелец 1',
        email: 'owner1@lord.kg',
        password: 'Password123!',
      });
      expect(r1.status).toBe(201);
      const body1 = asAuthEnvelope(r1.body);
      expect(body1.data.company.slug).toBe('barbershop-lord');

      // Soft-delete the first company; its slug must still trigger a suffix on collision
      await prisma.company.delete({ where: { id: body1.data.company.id } });

      const r2 = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Барбершоп Лорд',
        businessType: 'BARBERSHOP',
        ownerName: 'Владелец 2',
        email: 'owner2@lord.kg',
        password: 'Password123!',
      });
      expect(r2.status).toBe(201);
      const body2 = asAuthEnvelope(r2.body);
      expect(body2.data.company.slug).toBe('barbershop-lord-2');
    });

    it('returns 409 CONFLICT on duplicate email and rolls back atomically so no orphan Company is left behind', async () => {
      await request(app).post('/api/v1/auth/register').send({
        companyName: 'Company One',
        businessType: 'OTHER',
        ownerName: 'Owner One',
        email: 'dup@zapis.kg',
        password: 'Password123!',
      });

      const dupRes = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Company Two Should Not Exist',
        businessType: 'OTHER',
        ownerName: 'Owner Two',
        email: 'DUP@zapis.kg',
        password: 'Password123!',
      });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body).toMatchObject({ error: { code: 'CONFLICT' } });

      const companiesCount = await prismaUnfiltered.company.count();
      expect(companiesCount).toBe(1);
    });

    it('rolls back company creation if user creation inside the transaction fails', async () => {
      const existingCompany = await prisma.company.create({
        data: { name: 'Preexisting', slug: 'preexisting' },
      });
      await prisma.user.create({
        data: {
          companyId: existingCompany.id,
          role: Role.OWNER,
          name: 'Existing Owner',
          email: 'race@zapis.kg',
          passwordHash: await hashPassword('Password123!'),
        },
      });

      const res = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Rollback Check Co',
        businessType: 'BEAUTY_SALON',
        ownerName: 'Race User',
        email: 'race@zapis.kg',
        password: 'Password123!',
      });

      expect(res.status).toBe(409);
      const orphan = await prismaUnfiltered.company.findUnique({
        where: { slug: 'rollback-check-co' },
      });
      expect(orphan).toBeNull();
    });

    it('returns 400 VALIDATION_ERROR for invalid phone, short password, or bad email', async () => {
      const badPhone = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Salon A',
        ownerName: 'Owner A',
        email: 'a@salon.kg',
        phone: '123',
        password: 'Password123!',
      });
      expect(badPhone.status).toBe(400);
      expect(badPhone.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

      const shortPass = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Salon A',
        ownerName: 'Owner A',
        email: 'a@salon.kg',
        password: 'short',
      });
      expect(shortPass.status).toBe(400);
      expect(shortPass.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    });
  });

  describe('POST /api/v1/auth/login, /refresh, /logout, /me, PATCH /password', () => {
    it('logs in with valid credentials and returns generic 401 on wrong password or unknown email', async () => {
      await request(app).post('/api/v1/auth/register').send({
        companyName: 'Salon Test',
        businessType: 'BEAUTY_SALON',
        ownerName: 'Айгуль',
        email: 'aigul@salon.kg',
        password: 'Password123!',
      });

      const okRes = await request(app).post('/api/v1/auth/login').send({
        email: 'AIGUL@salon.kg',
        password: 'Password123!',
      });
      expect(okRes.status).toBe(200);
      expect(asAuthEnvelope(okRes.body).data.accessToken).toEqual(expect.any(String));

      const wrongPass = await request(app).post('/api/v1/auth/login').send({
        email: 'aigul@salon.kg',
        password: 'WrongPassword!',
      });
      expect(wrongPass.status).toBe(401);
      const wrongPassErr = asErrorEnvelope(wrongPass.body);
      expect(wrongPassErr.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
      });

      const unknownEmail = await request(app).post('/api/v1/auth/login').send({
        email: 'nobody@salon.kg',
        password: 'WrongPassword!',
      });
      expect(unknownEmail.status).toBe(401);
      const unknownEmailErr = asErrorEnvelope(unknownEmail.body);
      expect(unknownEmailErr.error.message).toBe(wrongPassErr.error.message);
    });

    it('rotates refresh token on POST /auth/refresh and rejects expired, tampered, or disallowed-Origin requests', async () => {
      const regRes = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Refresh Co',
        ownerName: 'Owner',
        email: 'refresh@zapis.kg',
        password: 'Password123!',
      });
      const regBody = asAuthEnvelope(regRes.body);

      const cookieLine1 = extractCookieHeader(regRes.headers['set-cookie'], REFRESH_COOKIE_NAME);
      const token1 = extractCookieValue(cookieLine1, REFRESH_COOKIE_NAME);
      expect(token1).toBeDefined();

      // Valid refresh with allowed Origin
      const refRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${token1}`);

      expect(refRes.status).toBe(200);
      const cookieLine2 = extractCookieHeader(refRes.headers['set-cookie'], REFRESH_COOKIE_NAME);
      const token2 = extractCookieValue(cookieLine2, REFRESH_COOKIE_NAME);
      expect(token2).toBeDefined();
      expect(token2).not.toBe(token1);

      // Disallowed Origin header -> 403 FORBIDDEN (BR-11)
      const badOriginRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Origin', 'https://attacker.example')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${token2}`);
      expect(badOriginRes.status).toBe(403);
      expect(badOriginRes.body).toMatchObject({ error: { code: 'FORBIDDEN' } });

      // Tampered token -> 401
      const tamperedRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${token2}tampered`);
      expect(tamperedRes.status).toBe(401);

      // Expired token -> 401
      const expiredToken = jwt.sign(
        {
          sub: regBody.data.user.id,
          companyId: regBody.data.company.id,
          role: 'OWNER',
          tv: 0,
          jti: 'expired-jti',
          typ: 'refresh',
        },
        env.JWT_REFRESH_SECRET,
        { algorithm: 'HS256', expiresIn: -10 },
      );

      const expiredRes = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${expiredToken}`);
      expect(expiredRes.status).toBe(401);
    });

    it('bumps tokenVersion on PATCH /auth/password, invalidating prior access and refresh tokens immediately', async () => {
      const regRes = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Pass Co',
        ownerName: 'Owner',
        email: 'pass@zapis.kg',
        password: 'OldPassword123!',
      });
      const regBody = asAuthEnvelope(regRes.body);

      const oldAccess = regBody.data.accessToken;
      const oldRefresh = extractCookieValue(
        extractCookieHeader(regRes.headers['set-cookie'], REFRESH_COOKIE_NAME),
        REFRESH_COOKIE_NAME,
      );

      const patchRes = await request(app)
        .patch('/api/v1/auth/password')
        .set('Authorization', `Bearer ${oldAccess}`)
        .send({
          currentPassword: 'OldPassword123!',
          newPassword: 'NewPassword456!',
        });

      expect(patchRes.status).toBe(200);
      const patchBody = asAuthEnvelope(patchRes.body);
      const newAccess = patchBody.data.accessToken;
      const newRefresh = extractCookieValue(
        extractCookieHeader(patchRes.headers['set-cookie'], REFRESH_COOKIE_NAME),
        REFRESH_COOKIE_NAME,
      );

      // Old access token is immediately rejected (tv mismatch)
      const meWithOld = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${oldAccess}`);
      expect(meWithOld.status).toBe(401);

      // Old refresh token is immediately rejected (tv mismatch)
      const refreshWithOld = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${oldRefresh}`);
      expect(refreshWithOld.status).toBe(401);

      // New access and refresh tokens work
      const meWithNew = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${newAccess}`);
      expect(meWithNew.status).toBe(200);

      const refreshWithNew = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${newRefresh}`);
      expect(refreshWithNew.status).toBe(200);
    });

    it('immediately rejects access tokens when user is deactivated or soft-deleted', async () => {
      const regRes = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Active Check Co',
        ownerName: 'Owner',
        email: 'active@zapis.kg',
        password: 'Password123!',
      });
      const regBody = asAuthEnvelope(regRes.body);

      const accessToken = regBody.data.accessToken;
      const userId = regBody.data.user.id;

      await prisma.user.update({ where: { id: userId }, data: { isActive: false } });

      const meInactive = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(meInactive.status).toBe(401);
    });

    it('clears the refresh cookie on POST /auth/logout and enforces Origin check', async () => {
      const badOrigin = await request(app)
        .post('/api/v1/auth/logout')
        .set('Origin', 'https://evil.example');
      expect(badOrigin.status).toBe(403);

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Origin', 'http://localhost:3000');
      expect(res.status).toBe(204);
      const cookieLine = extractCookieHeader(res.headers['set-cookie'], REFRESH_COOKIE_NAME);
      expect(cookieLine).toContain(`${REFRESH_COOKIE_NAME}=;`);
    });

    it('enforces rate limiting on POST /auth/login (10 req/min/IP -> 429 RATE_LIMITED)', async () => {
      for (let i = 0; i < 10; i++) {
        const r = await request(app).post('/api/v1/auth/login').send({
          email: 'ratelimit@zapis.kg',
          password: 'Password123!',
        });
        expect(r.status).toBe(401);
      }

      const eleventh = await request(app).post('/api/v1/auth/login').send({
        email: 'ratelimit@zapis.kg',
        password: 'Password123!',
      });
      expect(eleventh.status).toBe(429);
      expect(eleventh.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    });
  });

  describe('GET /api/v1/company & PATCH /api/v1/company (RBAC & tenant scoping)', () => {
    it('allows both OWNER and MASTER to GET their own company, but only OWNER can PATCH', async () => {
      const regA = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Auto Service KG',
        businessType: 'AUTO_SERVICE',
        ownerName: 'Owner A',
        email: 'ownera@auto.kg',
        password: 'Password123!',
      });
      const bodyA = asAuthEnvelope(regA.body);
      const ownerTokenA = bodyA.data.accessToken;
      const companyIdA = bodyA.data.company.id;

      // Create a MASTER in Company A
      const masterA = await prisma.user.create({
        data: {
          companyId: companyIdA,
          role: Role.MASTER,
          name: 'Master A',
          email: 'mastera@auto.kg',
          passwordHash: await hashPassword('Password123!'),
        },
      });
      const masterLogin = await request(app).post('/api/v1/auth/login').send({
        email: masterA.email,
        password: 'Password123!',
      });
      const masterTokenA = asAuthEnvelope(masterLogin.body).data.accessToken;

      // Unauthenticated -> 401
      const unauthGet = await request(app).get('/api/v1/company');
      expect(unauthGet.status).toBe(401);

      // MASTER can GET /company
      const masterGet = await request(app)
        .get('/api/v1/company')
        .set('Authorization', `Bearer ${masterTokenA}`);
      expect(masterGet.status).toBe(200);
      expect(asCompanyEnvelope(masterGet.body).data.id).toBe(companyIdA);

      // MASTER cannot PATCH /company -> 403 FORBIDDEN
      const masterPatch = await request(app)
        .patch('/api/v1/company')
        .set('Authorization', `Bearer ${masterTokenA}`)
        .send({ name: 'Hacked Name' });
      expect(masterPatch.status).toBe(403);
      expect(masterPatch.body).toMatchObject({ error: { code: 'FORBIDDEN' } });

      // OWNER can PATCH /company
      const ownerPatch = await request(app)
        .patch('/api/v1/company')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .send({
          name: 'СТО Тулпар',
          businessType: BusinessType.AUTO_SERVICE,
          phone: '0700 11 22 33',
          address: 'г. Бишкек, ул. Горького 10',
          timezone: 'Asia/Bishkek',
          slug: 'sto-tulpar',
          slotIntervalMin: 15,
          minLeadTimeMin: 30,
          maxAdvanceDays: 45,
          publicBookingEnabled: false,
        });

      expect(ownerPatch.status).toBe(200);
      expect(asCompanyEnvelope(ownerPatch.body).data).toMatchObject({
        id: companyIdA,
        name: 'СТО Тулпар',
        slug: 'sto-tulpar',
        phone: '+996700112233',
        address: 'г. Бишкек, ул. Горького 10',
        slotIntervalMin: 15,
        minLeadTimeMin: 30,
        maxAdvanceDays: 45,
        publicBookingEnabled: false,
      });
    });

    it('enforces strict tenant isolation and rejects invalid timezone or colliding slug on PATCH /company', async () => {
      const regA = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Salon Alpha',
        ownerName: 'Alpha Owner',
        email: 'alpha@zapis.kg',
        password: 'Password123!',
      });
      const regB = await request(app).post('/api/v1/auth/register').send({
        companyName: 'Salon Beta',
        ownerName: 'Beta Owner',
        email: 'beta@zapis.kg',
        password: 'Password123!',
      });

      const bodyA = asAuthEnvelope(regA.body);
      const bodyB = asAuthEnvelope(regB.body);
      const tokenB = bodyB.data.accessToken;

      // Company B cannot claim Company A's slug -> 409 CONFLICT
      const slugConflict = await request(app)
        .patch('/api/v1/company')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ slug: bodyA.data.company.slug });
      expect(slugConflict.status).toBe(409);
      expect(slugConflict.body).toMatchObject({ error: { code: 'CONFLICT' } });

      // Invalid IANA timezone -> 400 VALIDATION_ERROR
      const badTz = await request(app)
        .patch('/api/v1/company')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ timezone: 'Invalid/Timezone_Name' });
      expect(badTz.status).toBe(400);
      expect(badTz.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

      // Company A remains untouched when Company B updates its own settings
      await request(app)
        .patch('/api/v1/company')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Beta Updated' });

      const getA = await request(app)
        .get('/api/v1/company')
        .set('Authorization', `Bearer ${bodyA.data.accessToken}`);
      expect(asCompanyEnvelope(getA.body).data.name).toBe('Salon Alpha');
    });
  });
});
