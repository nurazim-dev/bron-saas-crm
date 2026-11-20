import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  AppointmentStatus,
  NotificationChannel,
  OutboxStatus,
  PaymentMethod,
  PaymentStatus,
  PrepaymentStatus,
  Prisma,
  Role,
  SubscriptionStatus,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAdminAccessToken } from '../../src/modules/admin/admin-crypto.js';
import { applyPrepaymentAction } from '../../src/modules/appointments/appointments.service.js';
import { createTrialSubscriptionForCompany } from '../../src/modules/billing/billing.service.js';
import { runOutboxDispatcherOnce } from '../../src/modules/notifications/dispatcher.service.js';
import {
  createTelegramLinkCode,
  processTelegramUpdate,
} from '../../src/modules/notifications/telegram-link.service.js';
import { runPrepaymentExpiryOnce } from '../../src/worker/jobs/prepayment-expiry.job.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

describe('Security Domain D: Business-Logic Abuse, 20-Way Concurrency Races & Policy Bypass', () => {
  const app = createApp();
  let clock: FakeClock;

  beforeEach(async () => {
    await truncateAllTables();
    app.set('trust proxy', 1);
    clock = new FakeClock(DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate());
    setClock(clock);
  });

  afterEach(() => {
    resetClock();
  });

  it('enforces single winner under 20 parallel same-slot bookings and 2 winners under 20 parallel any-master bookings (2 masters)', async () => {
    const company = await createCompanyFactory({
      slug: 'race-slot',
      publicBookingEnabled: true,
      minLeadTimeMin: 0,
    });
    const m1 = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    const m2 = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    const service = await createServiceFactory(company.id, { durationMin: 30 });

    for (const m of [m1, m2]) {
      await prisma.masterService.create({ data: { userId: m.id, serviceId: service.id } });
      for (let d = 1; d <= 7; d++) {
        await prisma.workingHours.create({
          data: { userId: m.id, dayOfWeek: d, startTime: '08:00', endTime: '20:00' },
        });
      }
    }

    // 1. 20 parallel same-slot bookings for m1
    const sameSlotResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post(`/api/v1/public/companies/${company.slug}/appointments`)
          .set('X-Forwarded-For', `10.10.1.${i + 1}`)
          .send({
            serviceId: service.id,
            masterId: m1.id,
            startAt: '2026-11-17T06:00:00.000Z',
            clientName: `Racer ${i}`,
            clientPhone: `+996700100${String(100 + i)}`,
            consentAccepted: true,
          }),
      ),
    );
    expect(sameSlotResults.filter((r) => r.status === 201).length).toBe(1);
    expect(sameSlotResults.filter((r) => r.status === 409).length).toBe(19);
    expect(sameSlotResults.some((r) => r.status >= 500)).toBe(false);

    // 2. 20 parallel any-master bookings across m1 & m2 for 07:00
    const anyMasterResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post(`/api/v1/public/companies/${company.slug}/appointments`)
          .set('X-Forwarded-For', `10.10.2.${i + 1}`)
          .send({
            serviceId: service.id,
            startAt: '2026-11-17T07:00:00.000Z',
            clientName: `AnyRacer ${i}`,
            clientPhone: `+996700200${String(100 + i)}`,
            consentAccepted: true,
          }),
      ),
    );
    expect(anyMasterResults.filter((r) => r.status === 201).length).toBe(2);
    expect(anyMasterResults.filter((r) => r.status === 409).length).toBe(18);
    expect(anyMasterResults.some((r) => r.status >= 500)).toBe(false);
  });

  it('enforces single winner under 20 parallel manage-link reschedules and 20 parallel cancels (SEC-003)', async () => {
    const company = await createCompanyFactory({
      slug: 'race-manage',
      publicBookingEnabled: true,
      minLeadTimeMin: 0,
      clientCancelMinHours: 1,
    });
    await createTrialSubscriptionForCompany(prisma, company.id);
    const master = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    const service = await createServiceFactory(company.id, { durationMin: 30 });
    await prisma.masterService.create({ data: { userId: master.id, serviceId: service.id } });
    for (let d = 1; d <= 7; d++) {
      await prisma.workingHours.create({
        data: { userId: master.id, dayOfWeek: d, startTime: '08:00', endTime: '22:00' },
      });
    }

    const appt = await createAppointmentFactory({
      companyId: company.id,
      masterId: master.id,
      serviceId: service.id,
      startAt: DateTime.fromISO('2026-11-18T05:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-18T05:30:00.000Z').toJSDate(),
      manageToken: 'sec_race_manage_tok_000000000000000000000001',
    });
    // Pre-set rescheduledCount = 1 (MAX_CLIENT_RESCHEDULES = 2 -> only 1 reschedule left)
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { rescheduledCount: 1 },
    });

    // 20 parallel reschedules to distinct valid slots (06:00, 06:30, ..., 15:30) -> exactly 1 winner (200), 19 (422)
    const rescheduleResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const slot = DateTime.fromISO('2026-11-18T06:00:00.000Z')
          .plus({ minutes: i * 30 })
          .toISO()!;
        return request(app)
          .post(`/api/v1/public/manage/${appt.manageToken}/reschedule`)
          .set('X-Forwarded-For', `10.20.1.${i + 1}`)
          .send({ startAt: slot });
      }),
    );

    expect(rescheduleResults.filter((r) => r.status === 200).length).toBe(1);
    expect(rescheduleResults.filter((r) => r.status === 422).length).toBe(19);
    expect(rescheduleResults.some((r) => r.status >= 500)).toBe(false);

    const afterReschedule = await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } });
    expect(afterReschedule.rescheduledCount).toBe(2);

    // 20 parallel cancels on the same appointment -> exactly 1 succeeds (200), 19 fail (422)
    const cancelResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post(`/api/v1/public/manage/${appt.manageToken}/cancel`)
          .set('X-Forwarded-For', `10.20.2.${i + 1}`)
          .send({ reason: `Cancel race ${i}` }),
      ),
    );
    expect(cancelResults.filter((r) => r.status === 200).length).toBe(1);
    expect(cancelResults.filter((r) => r.status === 422).length).toBe(19);
    expect(cancelResults.some((r) => r.status >= 500)).toBe(false);
  });

  it('enforces maxStaff and maxServices plan limits atomically under 20 parallel requests (SEC-002)', async () => {
    const company = await createCompanyFactory({ slug: 'race-limits' });
    await createTrialSubscriptionForCompany(prisma, company.id);
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });

    // Set plan limits: maxStaff = 2 (1 active owner already exists -> only 1 more staff allowed), maxServices = 1
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { companyId: company.id } });
    await prisma.plan.update({
      where: { id: sub.planId },
      data: { maxStaff: 2, maxServices: 1 },
    });

    const token = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    // 20 parallel staff creations -> exactly 1 succeeds (201), 19 rejected (402 PLAN_LIMIT_REACHED)
    const staffResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/v1/staff')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: `Parallel Master ${i}`,
            isActive: true,
            isBookable: true,
          }),
      ),
    );
    expect(staffResults.filter((r) => r.status === 201).length).toBe(1);
    expect(staffResults.filter((r) => r.status === 402).length).toBe(19);
    expect(await prisma.user.count({ where: { companyId: company.id, isActive: true } })).toBe(2);

    // 20 parallel service creations -> exactly 1 succeeds (201), 19 rejected (402 PLAN_LIMIT_REACHED)
    const serviceResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/v1/services')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: `Parallel Service ${i}`,
            durationMin: 30,
            price: '500.00',
            isActive: true,
          }),
      ),
    );
    expect(serviceResults.filter((r) => r.status === 201).length).toBe(1);
    expect(serviceResults.filter((r) => r.status === 402).length).toBe(19);
    expect(
      await prisma.service.count({ where: { companyId: company.id, isActive: true } }),
    ).toBe(1);
  });

  it('handles 20-way races on payment confirm, client anonymize, registration, prepayment RECEIVED vs expiry, outbox dispatch, and Telegram link-code reuse', async () => {
    const company = await createCompanyFactory({ slug: 'race-multi' });
    await createTrialSubscriptionForCompany(prisma, company.id);
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id);
    const admin = await prisma.platformAdmin.create({
      data: {
        email: 'race-admin@zapis.test',
        name: 'Race Admin',
        passwordHash: 'unused',
        isActive: true,
      },
    });
    const adminToken = signAdminAccessToken(admin);
    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    // 1. Subscription payment confirm 20 times in parallel -> 1 winner (200), 19 (409)
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { companyId: company.id } });
    const payment = await prisma.subscriptionPayment.create({
      data: {
        companyId: company.id,
        planId: sub.planId,
        amount: new Prisma.Decimal('1490.00'),
        currency: 'KGS',
        months: 1,
        method: PaymentMethod.BANK_TRANSFER,
        status: PaymentStatus.PENDING,
      },
    });
    const confirmResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app)
          .post(`/api/v1/admin/payments/${payment.id}/confirm`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({}),
      ),
    );
    expect(confirmResults.filter((r) => r.status === 200).length).toBe(1);
    expect(confirmResults.filter((r) => r.status === 409).length).toBe(19);

    // 2. Client anonymize 20 times in parallel -> 1 winner (200), 19 (409)
    const client = await prisma.client.create({
      data: { companyId: company.id, name: 'Race Anon', phone: '+996700888111' },
    });
    const anonResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app)
          .post(`/api/v1/clients/${client.id}/anonymize`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ confirm: true }),
      ),
    );
    expect(anonResults.filter((r) => r.status === 200).length).toBe(1);
    expect(anonResults.filter((r) => r.status === 409).length).toBe(19);

    // 3. Registration with same email/slug 20 times in parallel -> 1 winner (201), 19 (409), 0 (500)
    const regResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app)
          .post('/api/v1/auth/register')
          .set('X-Forwarded-For', `10.30.1.${i + 1}`)
          .send({
            companyName: 'Same Slug Barber',
            businessType: 'BARBERSHOP',
            ownerName: 'Same Owner',
            email: 'same.owner@zapis.test',
            phone: '+996555889900',
            password: 'Password123!',
            termsAccepted: true,
          }),
      ),
    );
    expect(regResults.filter((r) => r.status === 201).length).toBe(1);
    expect(regResults.filter((r) => r.status === 409).length).toBe(19);
    expect(regResults.some((r) => r.status >= 500)).toBe(false);

    // 4. Prepayment RECEIVED vs expiry race -> consistent final state, no 5xx
    const holdAppt = await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      startAt: DateTime.fromISO('2026-11-18T10:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-18T11:00:00.000Z').toJSDate(),
      prepaymentStatus: PrepaymentStatus.PENDING,
      prepaymentAmount: new Prisma.Decimal('200.00'),
      prepaymentHoldUntil: DateTime.fromISO('2026-11-16T07:50:00.000Z').toJSDate(),
    });
    await Promise.allSettled([
      applyPrepaymentAction(
        {
          userId: owner.id,
          companyId: company.id,
          role: Role.OWNER,
          tokenVersion: owner.tokenVersion,
        },
        holdAppt.id,
        'RECEIVED',
      ),
      runPrepaymentExpiryOnce(),
    ]);
    const finalAppt = await prisma.appointment.findUniqueOrThrow({ where: { id: holdAppt.id } });
    expect([PrepaymentStatus.RECEIVED, PrepaymentStatus.EXPIRED]).toContain(
      finalAppt.prepaymentStatus,
    );
    if (finalAppt.prepaymentStatus === PrepaymentStatus.EXPIRED) {
      expect(finalAppt.status).toBe(AppointmentStatus.CANCELLED);
    }

    // 5. Outbox dispatched exactly once under concurrent workers
    const outboxMsg = await prisma.outboxMessage.create({
      data: {
        companyId: company.id,
        channel: NotificationChannel.WHATSAPP_AUTO,
        kind: 'GENERIC',
        recipient: '+996700999111',
        payload: { subject: 'Once', text: 'Once' },
        status: OutboxStatus.PENDING,
        dedupeKey: `once-${randomUUID()}`,
        scheduledFor: DateTime.fromISO('2026-11-16T07:00:00.000Z').toJSDate(),
      },
    });
    await Promise.all(Array.from({ length: 10 }, () => runOutboxDispatcherOnce()));
    const outboxAfter = await prisma.outboxMessage.findUniqueOrThrow({
      where: { id: outboxMsg.id },
    });
    expect(outboxAfter.status).toBe(OutboxStatus.SENT);
    expect(outboxAfter.attempts).toBe(1);

    // 6. Telegram link-code reuse across 20 parallel updates -> only 1 chatId linked
    const tgLink = await createTelegramLinkCode({
      userId: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tokenVersion: owner.tokenVersion,
    });
    const code =
      (tgLink as { code?: string; deepLink?: string }).code ??
      (tgLink as { deepLink?: string }).deepLink?.split('start=')[1] ??
      '';
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        processTelegramUpdate({
          update_id: 900_000 + i,
          message: {
            message_id: 100 + i,
            chat: { id: 770000 + i },
            text: `/start ${code}`,
          },
        }),
      ),
    );
    const linkedUsers = await prisma.user.findMany({
      where: { companyId: company.id, telegramChatId: { not: null } },
    });
    expect(linkedUsers.length).toBe(1);
  });

  it('blocks tampering, phone format cap evasion, honeypot, and LOCKED/suspended bypass via HTTP verbs or Telegram Bot callbacks (SEC-001)', async () => {
    const company = await createCompanyFactory({
      slug: 'policy-sec',
      publicBookingEnabled: true,
      minLeadTimeMin: 0,
    });
    await createTrialSubscriptionForCompany(prisma, company.id);
    const owner = await createUserFactory(company.id, {
      role: Role.OWNER,
      isBookable: true,
      telegramChatId: '555444333',
    });
    const service = await createServiceFactory(company.id, { durationMin: 30 });
    await prisma.masterService.create({ data: { userId: owner.id, serviceId: service.id } });
    for (let d = 1; d <= 7; d++) {
      await prisma.workingHours.create({
        data: { userId: owner.id, dayOfWeek: d, startTime: '08:00', endTime: '20:00' },
      });
    }

    // 1. Honeypot returns synthetic 201 without creating DB appointment
    const hpRes = await request(app)
      .post(`/api/v1/public/companies/${company.slug}/appointments`)
      .send({
        serviceId: service.id,
        masterId: owner.id,
        startAt: '2026-11-17T06:00:00.000Z',
        clientName: 'Bot',
        clientPhone: '+996700111000',
        consentAccepted: true,
        website: 'https://spam.example.com',
      });
    expect(hpRes.status).toBe(201);
    expect(await prisma.appointment.count({ where: { companyId: company.id } })).toBe(0);

    // 2. Missing consent rejected with 400
    const noConsent = await request(app)
      .post(`/api/v1/public/companies/${company.slug}/appointments`)
      .send({
        serviceId: service.id,
        masterId: owner.id,
        startAt: '2026-11-17T06:00:00.000Z',
        clientName: 'No Consent',
        clientPhone: '+996700111000',
        consentAccepted: false,
      });
    expect(noConsent.status).toBe(400);

    // 3. Phone format variants normalize to E.164 and enforce max 3 upcoming bookings per phone
    const phoneVariants = ['0700 44-55-66', '+996 (700) 445566', '996700445566', '+996700445566'];
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post(`/api/v1/public/companies/${company.slug}/appointments`)
        .set('X-Forwarded-For', `10.40.1.${i + 1}`)
        .send({
          serviceId: service.id,
          masterId: owner.id,
          startAt: DateTime.fromISO('2026-11-17T06:00:00.000Z')
            .plus({ hours: i })
            .toISO(),
          clientName: 'Variant Client',
          clientPhone: phoneVariants[i],
          consentAccepted: true,
        });
      expect(r.status).toBe(201);
    }
    const fourthVariant = await request(app)
      .post(`/api/v1/public/companies/${company.slug}/appointments`)
      .set('X-Forwarded-For', '10.40.1.99')
      .send({
        serviceId: service.id,
        masterId: owner.id,
        startAt: '2026-11-17T10:00:00.000Z',
        clientName: 'Variant Client',
        clientPhone: phoneVariants[3],
        consentAccepted: true,
      });
    expect(fourthVariant.status).toBe(409);

    // 4. Telegram Bot must NOT allow staff appointment status mutation when subscription is LOCKED or company is suspended (SEC-001)
    const apptToMutate = await prisma.appointment.findFirstOrThrow({
      where: { companyId: company.id, status: AppointmentStatus.SCHEDULED },
    });
    await prisma.subscription.update({
      where: { companyId: company.id },
      data: {
        status: SubscriptionStatus.LOCKED,
        periodStartsAt: DateTime.fromISO('2026-10-01T00:00:00.000Z').toJSDate(),
        periodEndsAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate(),
      },
    });

    await processTelegramUpdate({
      update_id: 950_001,
      callback_query: {
        id: 'cb-locked-1',
        message: {
          message_id: 501,
          chat: { id: 555444333 },
        },
        data: `appt:${apptToMutate.id}:CONFIRMED`,
      },
    });

    const apptAfterLockedTg = await prisma.appointment.findUniqueOrThrow({
      where: { id: apptToMutate.id },
    });
    expect(apptAfterLockedTg.status).toBe(AppointmentStatus.SCHEDULED);

    // Also test when company is suspended
    await prisma.subscription.update({
      where: { companyId: company.id },
      data: { status: SubscriptionStatus.ACTIVE },
    });
    await prisma.company.update({
      where: { id: company.id },
      data: { suspendedAt: clock.now() },
    });

    await processTelegramUpdate({
      update_id: 950_002,
      callback_query: {
        id: 'cb-susp-1',
        message: {
          message_id: 502,
          chat: { id: 555444333 },
        },
        data: `appt:${apptToMutate.id}:CONFIRMED`,
      },
    });

    const apptAfterSuspendedTg = await prisma.appointment.findUniqueOrThrow({
      where: { id: apptToMutate.id },
    });
    expect(apptAfterSuspendedTg.status).toBe(AppointmentStatus.SCHEDULED);
  });
});
