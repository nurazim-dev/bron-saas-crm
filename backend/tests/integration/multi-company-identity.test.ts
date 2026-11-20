import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { BusinessType, OutboxStatus, Role } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import {
  addDaysToLocalDate,
  getTodayLocalDate,
  localDateTimeToUtc,
} from '../../src/lib/datetime.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma, prismaUnfiltered } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import type { AuthUserDto, CompanyMembershipDto } from '../../src/modules/auth/auth.service.js';
import type { CompanyDto } from '../../src/modules/company/company.service.js';
import { truncateAllTables } from '../helpers/db.js';
import { createAppointmentFactory, createServiceFactory } from '../helpers/factories.js';

interface AuthEnvelope {
  data: {
    accessToken: string;
    user: AuthUserDto;
    company: CompanyDto;
  };
}

interface CompaniesEnvelope {
  data: CompanyMembershipDto[];
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

const PASSWORD = 'Password123!';
const NEW_PASSWORD = 'NewPassword456!';

describe('Multi-company Identity & Switching (Foundation)', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    resetRateLimitersForTest();
  });

  afterEach(() => {
    resetClock();
  });

  async function registerCompany(email = 'owner@alpha.kg', companyName = 'Alpha Barbershop') {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/register')
      .send({
        companyName,
        businessType: BusinessType.BARBERSHOP,
        ownerName: 'Азамат',
        email,
        password: PASSWORD,
        termsAccepted: true,
      })
      .expect(201);
    return {
      agent,
      ...(res.body as AuthEnvelope).data,
    };
  }

  it('allows owner to create a second company, preserves original User/relations, switches both ways, and persists active company across refresh', async () => {
    const browser = await registerCompany('multi@zapis.kg', 'Alpha Barbershop');
    const companyA = browser.company;
    const ownerUserA = browser.user;

    // Seed data in Company A: service, workingHours, appointment, audit log
    const serviceA = await createServiceFactory(companyA.id, { name: 'Alpha Cut' });
    await prisma.masterService.create({ data: { userId: ownerUserA.id, serviceId: serviceA.id } });
    await prisma.workingHours.create({
      data: { userId: ownerUserA.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
    });
    const apptA = await createAppointmentFactory({
      companyId: companyA.id,
      masterId: ownerUserA.id,
      serviceId: serviceA.id,
      clientName: 'Client Alpha',
      clientPhone: '+996555010101',
    });

    // Re-login with original credentials -> lands in Company A with same user.id
    const reloginAgent = request.agent(app);
    const reloginRes = await reloginAgent
      .post('/api/v1/auth/login')
      .send({ email: 'multi@zapis.kg', password: PASSWORD })
      .expect(200);
    const reloginData = (reloginRes.body as AuthEnvelope).data;
    expect(reloginData.user.id).toBe(ownerUserA.id);
    expect(reloginData.company.id).toBe(companyA.id);

    // Create second company from cabinet
    const createRes = await reloginAgent
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${reloginData.accessToken}`)
      .send({ companyName: 'Beta Beauty', businessType: BusinessType.BEAUTY_SALON })
      .expect(201);
    const createdData = (createRes.body as AuthEnvelope).data;
    const companyB = createdData.company;
    const ownerUserB = createdData.user;

    expect(companyB.id).not.toBe(companyA.id);
    expect(companyB.name).toBe('Beta Beauty');
    expect(companyB.businessType).toBe(BusinessType.BEAUTY_SALON);
    expect(ownerUserB.id).not.toBe(ownerUserA.id);
    expect(ownerUserB.companyId).toBe(companyB.id);
    expect(ownerUserB.role).toBe(Role.OWNER);

    // Original User A and all its relations remain intact
    const userAStill = await prisma.user.findUniqueOrThrow({ where: { id: ownerUserA.id } });
    expect(userAStill.companyId).toBe(companyA.id);
    expect(await prisma.workingHours.count({ where: { userId: ownerUserA.id } })).toBe(1);
    expect(await prisma.appointment.findUnique({ where: { id: apptA.id } })).not.toBeNull();
    const createAudit = await prisma.auditLog.findFirst({
      where: { companyId: companyB.id, action: 'company.create_additional' },
    });
    expect(createAudit).not.toBeNull();

    // List companies shows both memberships with B current
    const listRes = await reloginAgent
      .get('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${createdData.accessToken}`)
      .expect(200);
    const memberships = (listRes.body as CompaniesEnvelope).data;
    expect(memberships).toHaveLength(2);
    expect(memberships.find((m) => m.companyId === companyB.id)?.isCurrent).toBe(true);
    expect(memberships.find((m) => m.companyId === companyA.id)?.isCurrent).toBe(false);

    // Refresh keeps Company B (and survives "page reload")
    const refreshBRes = await reloginAgent.post('/api/v1/auth/refresh').expect(200);
    const refreshBData = (refreshBRes.body as AuthEnvelope).data;
    expect(refreshBData.company.id).toBe(companyB.id);
    expect(refreshBData.user.id).toBe(ownerUserB.id);

    // Switch back to Company A
    const switchARes = await reloginAgent
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${refreshBData.accessToken}`)
      .send({ companyId: companyA.id })
      .expect(200);
    const switchAData = (switchARes.body as AuthEnvelope).data;
    expect(switchAData.company.id).toBe(companyA.id);
    expect(switchAData.user.id).toBe(ownerUserA.id);

    // Refresh now stays in Company A
    const refreshARes = await reloginAgent.post('/api/v1/auth/refresh').expect(200);
    expect((refreshARes.body as AuthEnvelope).data.company.id).toBe(companyA.id);

    // Subsequent login remembers lastCompanyId (switch to B, login fresh -> B)
    await reloginAgent
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${(refreshARes.body as AuthEnvelope).data.accessToken}`)
      .send({ companyId: companyB.id })
      .expect(200);

    const freshLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'multi@zapis.kg', password: PASSWORD })
      .expect(200);
    expect((freshLogin.body as AuthEnvelope).data.company.id).toBe(companyB.id);
  });

  it('enforces 404 cross-tenant isolation after switching and blocks stale/replayed/revoked tokens', async () => {
    const agent = request.agent(app);
    const regRes = await agent
      .post('/api/v1/auth/register')
      .send({
        companyName: 'Company One',
        businessType: BusinessType.BARBERSHOP,
        ownerName: 'Owner',
        email: 'tenant-switch@zapis.kg',
        password: PASSWORD,
        termsAccepted: true,
      })
      .expect(201);
    const authA = (regRes.body as AuthEnvelope).data;

    // Seed objects in Company A
    const serviceA = await createServiceFactory(authA.company.id, { name: 'Service A' });
    await prisma.masterService.create({ data: { userId: authA.user.id, serviceId: serviceA.id } });
    const apptA = await createAppointmentFactory({
      companyId: authA.company.id,
      masterId: authA.user.id,
      serviceId: serviceA.id,
      clientName: 'Client A',
      clientPhone: '+996555111222',
    });

    // Save pre-switch refresh cookie from a second login on Company A
    const oldDevice = request.agent(app);
    const oldDeviceLogin = await oldDevice
      .post('/api/v1/auth/login')
      .send({ email: 'tenant-switch@zapis.kg', password: PASSWORD })
      .expect(200);
    const oldDeviceToken = (oldDeviceLogin.body as AuthEnvelope).data.accessToken;

    // Switch primary agent to a newly created Company B
    const createB = await agent
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${authA.accessToken}`)
      .send({ companyName: 'Company Two', businessType: BusinessType.BEAUTY_SALON })
      .expect(201);
    const authB = (createB.body as AuthEnvelope).data;

    const serviceB = await createServiceFactory(authB.company.id, { name: 'Service B' });
    const apptB = await createAppointmentFactory({
      companyId: authB.company.id,
      masterId: authB.user.id,
      serviceId: serviceB.id,
      clientName: 'Client B',
      clientPhone: '+996555333444',
    });

    // Pre-switch access JWT (with sid revoked during createAdditionalCompany) -> 401
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${authA.accessToken}`)
      .expect(401);

    // Pre-switch legacy access JWT (no sid) for Company A cannot access Company B objects -> 404
    const legacyJwtA = signAccessToken({
      sub: authA.user.id,
      companyId: authA.company.id,
      role: Role.OWNER,
      tv: 0,
    });
    await request(app)
      .get(`/api/v1/appointments/${apptB.id}`)
      .set('Authorization', `Bearer ${legacyJwtA}`)
      .expect(404);
    await request(app)
      .patch(`/api/v1/services/${serviceB.id}`)
      .set('Authorization', `Bearer ${legacyJwtA}`)
      .send({ name: 'Hijack' })
      .expect(404);

    // While active in Company B, real HTTP requests to Company A objects return 404
    const headersB = { Authorization: `Bearer ${authB.accessToken}` };
    await request(app).get(`/api/v1/appointments/${apptA.id}`).set(headersB).expect(404);
    await request(app)
      .patch(`/api/v1/appointments/${apptA.id}`)
      .set(headersB)
      .send({ internalNote: 'Cross-tenant' })
      .expect(404);
    await request(app).delete(`/api/v1/appointments/${apptA.id}`).set(headersB).expect(404);
    await request(app)
      .patch(`/api/v1/services/${serviceA.id}`)
      .set(headersB)
      .send({ name: 'Cross-tenant' })
      .expect(404);
    await request(app).get(`/api/v1/clients/${apptA.clientId}`).set(headersB).expect(404);
    await request(app).get(`/api/v1/staff/${authA.user.id}`).set(headersB).expect(404);

    // Switch back to Company A on primary agent -> Company B objects now return 404
    const switchToA = await agent
      .post('/api/v1/auth/switch-company')
      .set(headersB)
      .send({ companyId: authA.company.id })
      .expect(200);
    const headersA2 = {
      Authorization: `Bearer ${(switchToA.body as AuthEnvelope).data.accessToken}`,
    };
    await request(app).get(`/api/v1/appointments/${apptB.id}`).set(headersA2).expect(404);

    // Old device on Company A was NOT revoked by primary agent's switches; let's test cross-company session revocation!
    const sessionsList = await request(app).get('/api/v1/auth/sessions').set(headersA2).expect(200);
    const sessions = (
      sessionsList.body as {
        data: Array<{ id: string; current: boolean; companyName: string | null }>;
      }
    ).data;
    expect(sessions).toHaveLength(2);
    const otherSession = sessions.find((s) => !s.current);
    expect(otherSession).toBeDefined();
    if (!otherSession) throw new Error('Expected second session');

    await request(app)
      .delete(`/api/v1/auth/sessions/${otherSession.id}`)
      .set(headersA2)
      .expect(204);

    // Revoked session's access token AND refresh cookie immediately return 401
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${oldDeviceToken}`)
      .expect(401);
    await oldDevice.post('/api/v1/auth/refresh').expect(401);

    // Test refresh token replay in Company B: capture cookie before refresh, replay after refresh -> revokes family
    const switchBackB = await agent
      .post('/api/v1/auth/switch-company')
      .set(headersA2)
      .send({ companyId: authB.company.id })
      .expect(200);
    const rawHeaders = switchBackB.headers as Record<string, unknown>;
    const setCookieB = rawHeaders['set-cookie'];
    const rawCookieHeaderB = Array.isArray(setCookieB)
      ? typeof setCookieB[0] === 'string'
        ? setCookieB[0]
        : undefined
      : typeof setCookieB === 'string'
        ? setCookieB
        : undefined;
    if (!rawCookieHeaderB) throw new Error('Expected refresh cookie');
    const cookiePairB = rawCookieHeaderB.split(';')[0] ?? '';

    const rotatedRes = await agent.post('/api/v1/auth/refresh').expect(200);
    const rotatedAccessB = (rotatedRes.body as AuthEnvelope).data.accessToken;

    // Replay the stale refresh cookie from before rotation
    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookiePairB).expect(401);

    // The entire session family is now revoked: rotated access & refresh both return 401
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${rotatedAccessB}`)
      .expect(401);
    await agent.post('/api/v1/auth/refresh').expect(401);

    const replayAudit = await prisma.auditLog.findFirst({
      where: { companyId: authB.company.id, action: 'auth.session_replay' },
    });
    expect(replayAudit).not.toBeNull();
  });

  it('enforces MANAGER and MASTER boundaries, rejects foreign companyId and role escalation, and respects per-membership roles', async () => {
    const ownerA = await registerCompany('owner-a@zapis.kg', 'Salon A');
    const ownerB = await registerCompany('owner-b@zapis.kg', 'Salon B');

    // Invite a MANAGER and create a MASTER in Company A
    const inviteMgr = await request(app)
      .post('/api/v1/staff/invite')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Manager A', email: 'mgr-a@zapis.kg', role: 'MANAGER' })
      .expect(201);
    const mgrToken = new URL((inviteMgr.body as { data: { url: string } }).data.url).hash.slice(1);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: mgrToken, newPassword: PASSWORD })
      .expect(204);

    const mgrLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'mgr-a@zapis.kg', password: PASSWORD })
      .expect(200);
    const mgrAuth = (mgrLogin.body as AuthEnvelope).data;

    await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Master A', email: 'master-a@zapis.kg', password: PASSWORD })
      .expect(201);
    const masterLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'master-a@zapis.kg', password: PASSWORD })
      .expect(200);
    const masterAuth = (masterLogin.body as AuthEnvelope).data;

    // MANAGER and MASTER cannot create additional companies -> 403
    await request(app)
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${mgrAuth.accessToken}`)
      .send({ companyName: 'Rogue Co', businessType: BusinessType.BARBERSHOP })
      .expect(403);
    await request(app)
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${masterAuth.accessToken}`)
      .send({ companyName: 'Rogue Co 2', businessType: BusinessType.BARBERSHOP })
      .expect(403);

    // OWNER, MANAGER, MASTER attempting to switch to foreign companyB -> 404
    for (const token of [ownerA.accessToken, mgrAuth.accessToken, masterAuth.accessToken]) {
      const res = await request(app)
        .post('/api/v1/auth/switch-company')
        .set('Authorization', `Bearer ${token}`)
        .send({ companyId: ownerB.company.id })
        .expect(404);
      expect((res.body as ErrorEnvelope).error.code).toBe('NOT_FOUND');
    }

    // Attempted role escalation in switch-company payload -> 400 VALIDATION_ERROR (strict schema)
    await request(app)
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${mgrAuth.accessToken}`)
      .send({ companyId: ownerA.company.id, role: 'OWNER' })
      .expect(400);

    // Mixed-role identity: same identity is OWNER in Company A and MASTER in Company B
    const ownerAIdentity = await prisma.user.findUniqueOrThrow({
      where: { id: ownerA.user.id },
      select: { identityId: true },
    });
    const memberMasterInB = await prisma.user.create({
      data: {
        companyId: ownerB.company.id,
        identityId: ownerAIdentity.identityId,
        role: Role.MASTER,
        name: 'Owner A as Master in B',
        email: 'owner-a@zapis.kg',
        passwordHash: await hashPassword(PASSWORD),
        isActive: true,
        isBookable: true,
      },
    });

    const switchedToB = await ownerA.agent
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ companyId: ownerB.company.id })
      .expect(200);
    const dataInB = (switchedToB.body as AuthEnvelope).data;
    expect(dataInB.user.id).toBe(memberMasterInB.id);
    expect(dataInB.user.role).toBe(Role.MASTER);
    expect(dataInB.company.id).toBe(ownerB.company.id);

    // While in Company B as MASTER, owner-only endpoints return 403
    await ownerA.agent
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${dataInB.accessToken}`)
      .send({ companyName: 'Cannot Create While Master', businessType: BusinessType.BARBERSHOP })
      .expect(403);
    await ownerA.agent
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${dataInB.accessToken}`)
      .send({ name: 'Nope' })
      .expect(403);
    await ownerA.agent
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${dataInB.accessToken}`)
      .send({ name: 'Nope' })
      .expect(403);

    // MANAGER in A retains normal manager rights
    const zone = ownerA.company.timezone;
    const tomorrow = addDaysToLocalDate(getTodayLocalDate(zone), 1, zone);
    const svcA = await createServiceFactory(ownerA.company.id, { name: 'Mgr Service' });
    await prisma.masterService.create({ data: { userId: ownerA.user.id, serviceId: svcA.id } });
    await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${mgrAuth.accessToken}`)
      .send({
        masterId: ownerA.user.id,
        serviceId: svcA.id,
        clientName: 'Mgr Client',
        clientPhone: '+996555888777',
        startAt: localDateTimeToUtc(tomorrow, '11:00', zone).toISOString(),
      })
      .expect(201);
    await request(app)
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${mgrAuth.accessToken}`)
      .expect(403);

    // Switch back to A -> restores OWNER role
    resetRateLimitersForTest();
    const backToA = await ownerA.agent
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${dataInB.accessToken}`)
      .send({ companyId: ownerA.company.id })
      .expect(200);
    expect((backToA.body as AuthEnvelope).data.user.role).toBe(Role.OWNER);
  });

  it('prevents email collision access and prevents Company A owner from hijacking a shared identity', async () => {
    const ownerA = await registerCompany('owner-a@zapis.kg', 'Company A');
    const ownerB = await registerCompany('shared@zapis.kg', 'Company B');

    // Matching email via POST /staff, POST /staff/invite, or POST /auth/register never grants access -> 409
    await request(app)
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Collision', email: 'shared@zapis.kg', password: PASSWORD })
      .expect(409);

    await request(app)
      .post('/api/v1/staff/invite')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ name: 'Collision Invite', email: 'shared@zapis.kg', role: 'MASTER' })
      .expect(409);

    await request(app)
      .post('/api/v1/auth/register')
      .send({
        companyName: 'Hijack Attempt Co',
        ownerName: 'Attacker',
        email: 'shared@zapis.kg',
        password: PASSWORD,
        termsAccepted: true,
      })
      .expect(409);

    expect(
      await prisma.user.count({
        where: { companyId: ownerA.company.id, email: 'shared@zapis.kg' },
      }),
    ).toBe(0);

    // Now give shared@zapis.kg a legitimate MASTER membership in Company A
    const ownerBIdentity = await prisma.user.findUniqueOrThrow({
      where: { id: ownerB.user.id },
      select: { identityId: true },
    });
    const sharedMemberInA = await prisma.user.create({
      data: {
        companyId: ownerA.company.id,
        identityId: ownerBIdentity.identityId,
        role: Role.MASTER,
        name: 'Shared Master in A',
        email: 'shared@zapis.kg',
        passwordHash: await hashPassword(PASSWORD),
        isActive: true,
        isBookable: true,
      },
    });

    // Owner of A CANNOT change shared member's password, email, remove email, or generate reset link -> 409 SHARED_IDENTITY
    const pwAttempt = await request(app)
      .patch(`/api/v1/staff/${sharedMemberInA.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ password: 'HijackedPassword123!' })
      .expect(409);
    expect((pwAttempt.body as ErrorEnvelope).error.code).toBe('SHARED_IDENTITY');

    const emailAttempt = await request(app)
      .patch(`/api/v1/staff/${sharedMemberInA.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ email: 'hijacked@zapis.kg' })
      .expect(409);
    expect((emailAttempt.body as ErrorEnvelope).error.code).toBe('SHARED_IDENTITY');

    const clearEmailAttempt = await request(app)
      .patch(`/api/v1/staff/${sharedMemberInA.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ email: null })
      .expect(409);
    expect((clearEmailAttempt.body as ErrorEnvelope).error.code).toBe('SHARED_IDENTITY');

    const resetLinkAttempt = await request(app)
      .post(`/api/v1/staff/${sharedMemberInA.id}/password-reset-link`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ sendEmail: false })
      .expect(409);
    expect((resetLinkAttempt.body as ErrorEnvelope).error.code).toBe('SHARED_IDENTITY');

    // Shared member logs into A on one agent and into B on another
    const agentInB = ownerB.agent;
    const agentInA = request.agent(app);
    const loginInA = await agentInA
      .post('/api/v1/auth/login')
      .send({ email: 'shared@zapis.kg', password: PASSWORD })
      .expect(200);
    // Switch agentInA to Company A
    const switchedA = await agentInA
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${(loginInA.body as AuthEnvelope).data.accessToken}`)
      .send({ companyId: ownerA.company.id })
      .expect(200);
    const tokenInA = (switchedA.body as AuthEnvelope).data.accessToken;

    // Owner A deactivates their staff member -> ONLY Company A membership stops working; Company B stays alive
    await request(app)
      .patch(`/api/v1/staff/${sharedMemberInA.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ isActive: false })
      .expect(200);

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokenInA}`)
      .expect(401);
    await agentInA.post('/api/v1/auth/refresh').expect(401);

    // Company B session and refresh still work!
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);
    await agentInB.post('/api/v1/auth/refresh').expect(200);

    // Owner A reactivates and then soft-deletes the membership in A -> Company B still works
    await request(app)
      .patch(`/api/v1/staff/${sharedMemberInA.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ isActive: true })
      .expect(200);
    await request(app)
      .delete(`/api/v1/staff/${sharedMemberInA.id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(204);

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .expect(200);
  });

  it('keeps password change, password reset, email verification, invitations, and logout consistent across companies', async () => {
    setClock(new FakeClock('2026-11-19T10:00:00.000Z'));

    // Register Company A and create Company B
    const device1 = await registerCompany('allflows@zapis.kg', 'Flow Alpha');
    const createB = await device1.agent
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${device1.accessToken}`)
      .send({ companyName: 'Flow Beta', businessType: BusinessType.BEAUTY_SALON })
      .expect(201);
    const sessionB = (createB.body as AuthEnvelope).data;

    // Second device logs in and stays in Company A
    const device2 = request.agent(app);
    const d2Login = await device2
      .post('/api/v1/auth/login')
      .send({ email: 'allflows@zapis.kg', password: PASSWORD })
      .expect(200);
    const d2SwitchA = await device2
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${(d2Login.body as AuthEnvelope).data.accessToken}`)
      .send({ companyId: device1.company.id })
      .expect(200);
    const d2TokenA = (d2SwitchA.body as AuthEnvelope).data.accessToken;

    // Email verification: request on Company B -> confirm -> both A & B memberships become verified
    await device1.agent
      .post('/api/v1/auth/email-verification/request')
      .set('Authorization', `Bearer ${sessionB.accessToken}`)
      .expect(202);
    const verifyOutbox = await prisma.outboxMessage.findFirstOrThrow({
      where: {
        companyId: sessionB.company.id,
        kind: 'EMAIL_VERIFICATION',
        status: OutboxStatus.PENDING,
      },
    });
    const verifyUrl = (verifyOutbox.payload as { verifyUrl: string }).verifyUrl;
    const verifyToken = new URL(verifyUrl).hash.slice(1);
    await request(app)
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token: verifyToken })
      .expect(204);

    const membersAfterVerify = await prisma.user.findMany({
      where: { email: 'allflows@zapis.kg' },
      select: { emailVerifiedAt: true },
    });
    expect(membersAfterVerify).toHaveLength(2);
    expect(membersAfterVerify.every((m) => m.emailVerifiedAt !== null)).toBe(true);

    // Password change on device1 (Company B) revokes device2 (Company A) as well
    const pwChange = await device1.agent
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${sessionB.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    const afterPwToken = (pwChange.body as AuthEnvelope).data.accessToken;

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${d2TokenA}`)
      .expect(401);
    await device2.post('/api/v1/auth/refresh').expect(401);

    // Forgot + reset password resets shared identity and revokes device1's current session too
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'allflows@zapis.kg' })
      .expect(202);
    const resetOutbox = await prisma.outboxMessage.findFirstOrThrow({
      where: { kind: 'PASSWORD_RESET', status: OutboxStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    const resetUrl = (resetOutbox.payload as { resetUrl: string }).resetUrl;
    const resetToken = new URL(resetUrl).searchParams.get('token');
    expect(resetToken).toBeTruthy();

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: 'ResetPassword789!' })
      .expect(204);

    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${afterPwToken}`)
      .expect(401);
    await device1.agent.post('/api/v1/auth/refresh').expect(401);

    // Login with reset password works and can logout cleanly
    resetRateLimitersForTest();
    const freshAgent = request.agent(app);
    const freshLogin = await freshAgent
      .post('/api/v1/auth/login')
      .send({ email: 'allflows@zapis.kg', password: 'ResetPassword789!' })
      .expect(200);
    const freshToken = (freshLogin.body as AuthEnvelope).data.accessToken;

    await freshAgent.post('/api/v1/auth/logout').expect(204);
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(401);
    await freshAgent.post('/api/v1/auth/refresh').expect(401);
  });

  it('preserves PlatformAdmin isolation and read-only scoped impersonation', async () => {
    const adminPasswordHash = await hashPassword('AdminPassword123!');
    await prisma.platformAdmin.create({
      data: {
        email: 'root-admin@zapis.kg',
        name: 'Admin',
        passwordHash: adminPasswordHash,
        isActive: true,
      },
    });
    const adminLoginRes = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'root-admin@zapis.kg', password: 'AdminPassword123!' })
      .expect(200);
    const adminToken = (adminLoginRes.body as { data: { accessToken: string } }).data.accessToken;

    // PlatformAdmin JWT cannot access tenant/multi-company endpoints -> 401
    await request(app)
      .get('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyId: '00000000-0000-4000-8000-000000000001' })
      .expect(401);

    // Owner with two companies
    const owner = await registerCompany('imp-owner@zapis.kg', 'Imp Alpha');
    const createB = await owner.agent
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ companyName: 'Imp Beta', businessType: BusinessType.BEAUTY_SALON })
      .expect(201);
    const companyBId = (createB.body as AuthEnvelope).data.company.id;

    // Admin impersonates Company A
    const impStart = await request(app)
      .post(`/api/v1/admin/companies/${owner.company.id}/impersonate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Check multi-company isolation' })
      .expect(200);
    const code = (impStart.body as { data: { code: string } }).data.code;
    const exchange = await request(app)
      .post('/api/v1/auth/impersonate/exchange')
      .send({ code })
      .expect(200);
    const impToken = (exchange.body as { data: { accessToken: string } }).data.accessToken;

    // Impersonation sees ONLY Company A in /auth/companies
    const impCompanies = await request(app)
      .get('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${impToken}`)
      .expect(200);
    const impList = (impCompanies.body as CompaniesEnvelope).data;
    expect(impList).toHaveLength(1);
    expect(impList[0]?.companyId).toBe(owner.company.id);

    // Impersonation cannot switch company or create a company -> 403 IMPERSONATION_READ_ONLY
    const impSwitch = await request(app)
      .post('/api/v1/auth/switch-company')
      .set('Authorization', `Bearer ${impToken}`)
      .send({ companyId: companyBId })
      .expect(403);
    expect((impSwitch.body as ErrorEnvelope).error.code).toBe('IMPERSONATION_READ_ONLY');

    const impCreate = await request(app)
      .post('/api/v1/auth/companies')
      .set('Authorization', `Bearer ${impToken}`)
      .send({ companyName: 'Blocked', businessType: BusinessType.BARBERSHOP })
      .expect(403);
    expect((impCreate.body as ErrorEnvelope).error.code).toBe('IMPERSONATION_READ_ONLY');
  });

  it('enforces PostgreSQL identity/email consistency constraints directly in DB', async () => {
    const owner = await registerCompany('dbcheck@zapis.kg', 'DB Check Co');

    // Violate User_email_identity_check (email without identityId)
    await expect(
      prismaUnfiltered.$executeRaw`
        UPDATE "User" SET "identityId" = NULL WHERE "id" = ${owner.user.id}::uuid`,
    ).rejects.toThrow();

    // Violate User_identity_email_match (User.email diverges from Identity.email)
    await expect(
      prismaUnfiltered.$executeRaw`
        UPDATE "User" SET "email" = 'diverged@zapis.kg' WHERE "id" = ${owner.user.id}::uuid`,
    ).rejects.toThrow();
  });
});
