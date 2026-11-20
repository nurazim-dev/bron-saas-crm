import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  BusinessPaymentKind,
  BusinessPaymentStatus,
  NotificationChannel,
  OutboxStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
  SubscriptionStatus,
  TimeOffKind,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken, signImpersonationAccessToken } from '../../src/lib/jwt.js';
import { prisma, prismaUnfiltered } from '../../src/lib/prisma.js';
import { signAdminAccessToken } from '../../src/modules/admin/admin-crypto.js';
import { createTrialSubscriptionForCompany } from '../../src/modules/billing/billing.service.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

function asBody(body: unknown): {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
} {
  return body as {
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  };
}

describe('Security Domain A: Access Control, Tenancy, Mass Assignment & Public Privacy', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    setClock(new FakeClock(DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate()));
  });

  afterEach(() => {
    resetClock();
  });

  it('enforces full access-control matrix across all object types and actor states (BR-5)', async () => {
    const companyA = await createCompanyFactory({ slug: 'alpha-sec' });
    const companyB = await createCompanyFactory({ slug: 'beta-sec' });
    const companySuspended = await createCompanyFactory({ slug: 'susp-sec' });
    const companyLocked = await createCompanyFactory({ slug: 'lock-sec' });

    await createTrialSubscriptionForCompany(prisma, companyA.id);
    await createTrialSubscriptionForCompany(prisma, companyB.id);
    await createTrialSubscriptionForCompany(prisma, companySuspended.id);
    await createTrialSubscriptionForCompany(prisma, companyLocked.id);

    await prisma.company.update({
      where: { id: companySuspended.id },
      data: { suspendedAt: DateTime.fromISO('2026-11-16T07:00:00.000Z').toJSDate() },
    });
    await prisma.subscription.update({
      where: { companyId: companyLocked.id },
      data: {
        status: SubscriptionStatus.LOCKED,
        periodStartsAt: DateTime.fromISO('2026-10-01T00:00:00.000Z').toJSDate(),
        periodEndsAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate(),
      },
    });

    const ownerA = await createUserFactory(companyA.id, { role: Role.OWNER, isBookable: true });
    const masterA1 = await createUserFactory(companyA.id, { role: Role.MASTER, isBookable: true });
    const masterA2 = await createUserFactory(companyA.id, { role: Role.MASTER, isBookable: true });
    const deletedUserA = await createUserFactory(companyA.id, {
      role: Role.OWNER,
      isBookable: true,
    });
    await prismaUnfiltered.user.update({
      where: { id: deletedUserA.id },
      data: { deletedAt: DateTime.fromISO('2026-11-16T07:00:00.000Z').toJSDate() },
    });

    const ownerB = await createUserFactory(companyB.id, { role: Role.OWNER, isBookable: true });
    const masterB = await createUserFactory(companyB.id, { role: Role.MASTER, isBookable: true });
    const ownerSusp = await createUserFactory(companySuspended.id, {
      role: Role.OWNER,
      isBookable: true,
    });
    const ownerLocked = await createUserFactory(companyLocked.id, {
      role: Role.OWNER,
      isBookable: true,
    });

    const admin = await prisma.platformAdmin.create({
      data: {
        email: 'sec-admin@zapis.test',
        name: 'Sec Admin',
        passwordHash: 'not-used-directly',
        isActive: true,
      },
    });

    // Objects owned by Company B
    const serviceB = await createServiceFactory(companyB.id);
    const clientB = await prisma.client.create({
      data: { companyId: companyB.id, name: 'Client B', phone: '+996555000222' },
    });
    const apptB = await createAppointmentFactory({
      companyId: companyB.id,
      masterId: masterB.id,
      serviceId: serviceB.id,
      clientName: clientB.name,
      clientPhone: clientB.phone,
      startAt: DateTime.fromISO('2026-11-17T06:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-17T07:00:00.000Z').toJSDate(),
    });
    const timeOffB = await prisma.timeOff.create({
      data: {
        companyId: companyB.id,
        userId: masterB.id,
        startAt: DateTime.fromISO('2026-11-18T06:00:00.000Z').toJSDate(),
        endAt: DateTime.fromISO('2026-11-18T08:00:00.000Z').toJSDate(),
        kind: TimeOffKind.VACATION,
      },
    });
    const notifB = await prisma.inAppNotification.create({
      data: {
        companyId: companyB.id,
        userId: ownerB.id,
        kind: 'NEW_BOOKING',
        title: 'Notification B',
        body: 'Body B',
      },
    });
    const bizPaymentB = await prisma.businessPayment.create({
      data: {
        companyId: companyB.id,
        clientId: clientB.id,
        appointmentId: apptB.id,
        kind: BusinessPaymentKind.PAYMENT,
        status: BusinessPaymentStatus.PENDING,
        method: PaymentMethod.CASH,
        amount: new Prisma.Decimal('500.00'),
        currency: 'KGS',
      },
    });
    const subB = await prisma.subscription.findUniqueOrThrow({ where: { companyId: companyB.id } });
    const subPaymentB = await prisma.subscriptionPayment.create({
      data: {
        companyId: companyB.id,
        planId: subB.planId,
        amount: new Prisma.Decimal('1490.00'),
        currency: 'KGS',
        months: 1,
        method: PaymentMethod.BANK_TRANSFER,
        status: PaymentStatus.PENDING,
      },
    });
    const outboxB = await prisma.outboxMessage.create({
      data: {
        companyId: companyB.id,
        channel: NotificationChannel.EMAIL,
        kind: 'GENERIC',
        recipient: 'ownerb@zapis.test',
        payload: { subject: 'Test', text: 'Test' },
        status: OutboxStatus.FAILED,
        dedupeKey: `sec-outbox-${randomUUID()}`,
        scheduledFor: DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate(),
      },
    });

    // Objects owned by Master A2 inside Company A (for intra-company MASTER isolation)
    const serviceA = await createServiceFactory(companyA.id);
    const clientA2 = await prisma.client.create({
      data: { companyId: companyA.id, name: 'Client A2', phone: '+996555000112' },
    });
    const apptA2 = await createAppointmentFactory({
      companyId: companyA.id,
      masterId: masterA2.id,
      serviceId: serviceA.id,
      clientName: clientA2.name,
      clientPhone: clientA2.phone,
      startAt: DateTime.fromISO('2026-11-17T08:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-17T09:00:00.000Z').toJSDate(),
    });
    const timeOffA2 = await prisma.timeOff.create({
      data: {
        companyId: companyA.id,
        userId: masterA2.id,
        startAt: DateTime.fromISO('2026-11-18T08:00:00.000Z').toJSDate(),
        endAt: DateTime.fromISO('2026-11-18T10:00:00.000Z').toJSDate(),
        kind: TimeOffKind.VACATION,
      },
    });

    const tokenOwnerA = signAccessToken({
      sub: ownerA.id,
      companyId: companyA.id,
      role: Role.OWNER,
      tv: ownerA.tokenVersion,
    });
    const tokenMasterA1 = signAccessToken({
      sub: masterA1.id,
      companyId: companyA.id,
      role: Role.MASTER,
      tv: masterA1.tokenVersion,
    });
    const tokenDeletedA = signAccessToken({
      sub: deletedUserA.id,
      companyId: companyA.id,
      role: Role.OWNER,
      tv: deletedUserA.tokenVersion,
    });
    const tokenSuspended = signAccessToken({
      sub: ownerSusp.id,
      companyId: companySuspended.id,
      role: Role.OWNER,
      tv: ownerSusp.tokenVersion,
    });
    const tokenLocked = signAccessToken({
      sub: ownerLocked.id,
      companyId: companyLocked.id,
      role: Role.OWNER,
      tv: ownerLocked.tokenVersion,
    });
    const tokenImpersonation = signImpersonationAccessToken({
      sub: ownerA.id,
      companyId: companyA.id,
      role: Role.OWNER,
      tv: ownerA.tokenVersion,
      imp: admin.id,
    });
    const tokenAdmin = signAdminAccessToken(admin);

    // 1. Anonymous requests to staff and admin endpoints -> 401
    const staffAndAdminProtected: Array<['get' | 'post' | 'patch' | 'delete', string]> = [
      ['get', '/api/v1/company'],
      ['patch', '/api/v1/company'],
      ['get', '/api/v1/services'],
      ['post', '/api/v1/services'],
      ['get', '/api/v1/staff'],
      ['post', '/api/v1/staff'],
      ['get', '/api/v1/appointments'],
      ['post', '/api/v1/appointments'],
      ['get', '/api/v1/clients'],
      ['post', '/api/v1/clients'],
      ['get', '/api/v1/time-off'],
      ['post', '/api/v1/time-off'],
      ['get', '/api/v1/payments'],
      ['post', '/api/v1/payments'],
      ['get', '/api/v1/billing'],
      ['get', '/api/v1/notifications'],
      ['get', '/api/v1/search?q=test'],
      ['get', '/api/v1/admin/companies'],
      ['get', '/api/v1/admin/users'],
      ['get', '/api/v1/admin/plans'],
      ['get', '/api/v1/admin/payments'],
      ['get', '/api/v1/admin/outbox'],
      ['get', `/api/v1/admin/outbox/${outboxB.id}/retry`],
    ];
    for (const [m, url] of staffAndAdminProtected) {
      const res = await request(app)[m](url);
      expect(res.status, `Anon ${m.toUpperCase()} ${url}`).toBe(401);
    }

    // 2. Token boundary: Admin token on staff routes -> 401; Staff token on admin routes -> 401
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${tokenAdmin}`))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/companies')
          .set('Authorization', `Bearer ${tokenOwnerA}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/outbox/${outboxB.id}/retry`)
          .set('Authorization', `Bearer ${tokenOwnerA}`)
      ).status,
    ).toBe(401);

    // 3. Soft-deleted user's token -> 401
    expect(
      (await request(app).get('/api/v1/company').set('Authorization', `Bearer ${tokenDeletedA}`))
        .status,
    ).toBe(401);

    // 4. Suspended-company token -> 403 COMPANY_SUSPENDED
    const suspRes = await request(app)
      .get('/api/v1/company')
      .set('Authorization', `Bearer ${tokenSuspended}`);
    expect(suspRes.status).toBe(403);
    expect(asBody(suspRes.body).error?.code).toBe('COMPANY_SUSPENDED');

    // 5. Billing-LOCKED token -> GET allowed (200), non-allowlisted staff writes -> 402 SUBSCRIPTION_REQUIRED
    expect(
      (await request(app).get('/api/v1/services').set('Authorization', `Bearer ${tokenLocked}`))
        .status,
    ).toBe(200);
    const lockedWriteRoutes: Array<
      ['post' | 'patch' | 'delete', string, Record<string, unknown>?]
    > = [
      ['post', '/api/v1/services', { name: 'New', durationMin: 30, price: '500.00' }],
      ['post', '/api/v1/staff', { name: 'Master X', isActive: true, isBookable: true }],
      ['post', '/api/v1/clients', { name: 'Client X', phone: '+996700111222' }],
      ['patch', '/api/v1/company', { name: 'Renamed' }],
      [
        'post',
        '/api/v1/time-off',
        {
          userId: ownerLocked.id,
          startAt: '2026-11-19T06:00:00.000Z',
          endAt: '2026-11-19T08:00:00.000Z',
          kind: 'BREAK',
        },
      ],
    ];
    for (const [m, url, body] of lockedWriteRoutes) {
      const res = await request(app)
        [m](url)
        .set('Authorization', `Bearer ${tokenLocked}`)
        .send(body ?? {});
      expect(res.status, `LOCKED ${m.toUpperCase()} ${url}`).toBe(402);
    }

    // 6. Impersonation token -> every non-GET (except /api/v1/auth/impersonate/exit) -> 403 IMPERSONATION_READ_ONLY
    expect(
      (
        await request(app)
          .get('/api/v1/company')
          .set('Authorization', `Bearer ${tokenImpersonation}`)
      ).status,
    ).toBe(200);
    for (const [m, url, body] of lockedWriteRoutes) {
      const res = await request(app)
        [m](url)
        .set('Authorization', `Bearer ${tokenImpersonation}`)
        .send(body ?? {});
      expect(res.status, `Impersonation ${m.toUpperCase()} ${url}`).toBe(403);
      expect(asBody(res.body).error?.code).toBe('IMPERSONATION_READ_ONLY');
    }

    // 7. Wrong role (MASTER calling OWNER-only routes) -> 403 FORBIDDEN
    const ownerOnlyRoutes: Array<['get' | 'post' | 'patch' | 'delete', string]> = [
      ['patch', '/api/v1/company'],
      ['post', '/api/v1/services'],
      ['post', '/api/v1/staff'],
      ['post', '/api/v1/clients'],
      ['get', '/api/v1/billing'],
      ['get', '/api/v1/export/clients.csv'],
      ['get', '/api/v1/export/appointments.csv?from=2026-11-01&to=2026-11-16'],
      ['get', '/api/v1/export/payments.csv?from=2026-11-01&to=2026-11-16'],
      ['get', '/api/v1/onboarding'],
    ];
    for (const [m, url] of ownerOnlyRoutes) {
      const res = await request(app)[m](url).set('Authorization', `Bearer ${tokenMasterA1}`);
      expect(res.status, `MASTER on OWNER-only ${m.toUpperCase()} ${url}`).toBe(403);
    }

    // 8. Cross-tenant object access (Owner A & Master A1 accessing Company B objects) -> 404 NOT_FOUND
    const crossTenantObjects: Array<
      ['get' | 'patch' | 'post' | 'delete', string, Record<string, unknown>?]
    > = [
      ['get', `/api/v1/appointments/${apptB.id}`],
      ['patch', `/api/v1/appointments/${apptB.id}`, { internalNote: 'X' }],
      ['patch', `/api/v1/appointments/${apptB.id}/status`, { status: 'CONFIRMED' }],
      ['delete', `/api/v1/appointments/${apptB.id}`],
      ['get', `/api/v1/clients/${clientB.id}`],
      ['patch', `/api/v1/clients/${clientB.id}`, { name: 'Hijack' }],
      ['post', `/api/v1/clients/${clientB.id}/anonymize`, { confirm: true }],
      ['patch', `/api/v1/services/${serviceB.id}`, { name: 'Hijack' }],
      ['delete', `/api/v1/services/${serviceB.id}`],
      ['patch', `/api/v1/staff/${masterB.id}`, { name: 'Hijack' }],
      ['delete', `/api/v1/staff/${masterB.id}`],
      ['delete', `/api/v1/time-off/${timeOffB.id}`],
      ['patch', `/api/v1/notifications/${notifB.id}/read`],
      ['post', `/api/v1/payments/${bizPaymentB.id}/confirm`],
      ['delete', `/api/v1/billing/payments/${subPaymentB.id}`],
    ];
    for (const [m, url, body] of crossTenantObjects) {
      const res = await request(app)
        [m](url)
        .set('Authorization', `Bearer ${tokenOwnerA}`)
        .send(body ?? {});
      expect(res.status, `Cross-tenant OwnerA ${m.toUpperCase()} ${url}`).toBe(404);
    }

    // 9. Intra-company MASTER isolation (Master A1 accessing Master A2's appointment, client, time-off) -> 404 NOT_FOUND
    expect(
      (
        await request(app)
          .get(`/api/v1/appointments/${apptA2.id}`)
          .set('Authorization', `Bearer ${tokenMasterA1}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/clients/${clientA2.id}`)
          .set('Authorization', `Bearer ${tokenMasterA1}`)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .delete(`/api/v1/time-off/${timeOffA2.id}`)
          .set('Authorization', `Bearer ${tokenMasterA1}`)
      ).status,
    ).toBe(404);
  });

  it('prevents mass assignment of forbidden fields and leaks zero internal/PII data on public endpoints', async () => {
    const company = await createCompanyFactory({
      slug: 'mass-sec',
      publicBookingEnabled: true,
      minLeadTimeMin: 0,
    });
    const otherCompany = await createCompanyFactory({ slug: 'other-mass' });
    await createTrialSubscriptionForCompany(prisma, company.id);
    await createTrialSubscriptionForCompany(prisma, otherCompany.id);
    const owner = await createUserFactory(company.id, {
      role: Role.OWNER,
      email: 'secret-owner-email@zapis.test',
      isBookable: true,
    });
    const service = await createServiceFactory(company.id, {
      price: new Prisma.Decimal('1000.00'),
      durationMin: 30,
    });
    await prisma.masterService.create({ data: { userId: owner.id, serviceId: service.id } });
    for (let d = 1; d <= 7; d++) {
      await prisma.workingHours.create({
        data: { userId: owner.id, dayOfWeek: d, startTime: '08:00', endTime: '20:00' },
      });
    }

    const tokenOwner = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    // Mass assignment on company PATCH (id, slug, subscription, deletedAt, suspendedAt must be rejected/ignored)
    const patchCompanyRes = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({
        name: 'Safe Name',
        id: otherCompany.id,
        companyId: otherCompany.id,
        deletedAt: null,
        suspendedAt: null,
      });
    if (patchCompanyRes.status === 200) {
      expect(asBody(patchCompanyRes.body).data?.id).toBe(company.id);
    } else {
      expect(patchCompanyRes.status).toBe(400);
    }

    // Mass assignment on public booking (price, status, companyId, manageToken, prepaymentStatus must never apply)
    const forgedToken = 'forged_manage_token_000000000000000000000000000';
    const bookRes = await request(app)
      .post(`/api/v1/public/companies/${company.slug}/appointments`)
      .send({
        serviceId: service.id,
        masterId: owner.id,
        startAt: '2026-11-17T06:00:00.000Z',
        clientName: 'Honest Client',
        clientPhone: '+996700555666',
        consentAccepted: true,
        price: '1.00',
        status: 'COMPLETED',
        companyId: otherCompany.id,
        manageToken: forgedToken,
        prepaymentStatus: 'RECEIVED',
      });
    if (bookRes.status === 201) {
      expect(asBody(bookRes.body).data?.price).toBe('1000.00');
      expect(asBody(bookRes.body).data?.status).toBe('SCHEDULED');
      expect(JSON.stringify(asBody(bookRes.body).data)).not.toContain(forgedToken);
    } else {
      expect(bookRes.status).toBe(400);
    }

    // Public company profile leaks no staff emails, passwordHashes, or internal data
    const pubProfile = await request(app).get(`/api/v1/public/companies/${company.slug}`);
    expect(pubProfile.status).toBe(200);
    const rawJson = JSON.stringify(pubProfile.body);
    expect(rawJson).not.toContain('secret-owner-email@zapis.test');
    expect(rawJson).not.toContain('passwordHash');
    expect(rawJson).not.toContain('tokenVersion');

    // Blocked client refusal is indistinguishable from a generic booking unavailable refusal
    await prisma.client.create({
      data: {
        companyId: company.id,
        name: 'Blocked User',
        phone: '+996700999888',
        isBlocked: true,
      },
    });
    const blockedBook = await request(app)
      .post(`/api/v1/public/companies/${company.slug}/appointments`)
      .send({
        serviceId: service.id,
        masterId: owner.id,
        startAt: '2026-11-17T07:00:00.000Z',
        clientName: 'Blocked User',
        clientPhone: '+996700999888',
        consentAccepted: true,
      });
    expect([403, 422]).toContain(blockedBook.status);
    expect(['BOOKING_UNAVAILABLE', 'BOOKING_NOT_ALLOWED']).toContain(
      asBody(blockedBook.body).error?.code,
    );
    expect(JSON.stringify(blockedBook.body)).not.toMatch(/block|заблок/i);
  });
});
