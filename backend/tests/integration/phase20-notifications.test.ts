import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import {
  AppointmentSource,
  AppointmentStatus,
  Locale,
  NotificationChannel,
  OutboxStatus,
  Prisma,
  ReminderMode,
  Role,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetProviderRegistry, setProviderRegistry } from '../../src/lib/registry.js';
import { runOutboxDispatcherOnce } from '../../src/modules/notifications/dispatcher.service.js';
import type {
  ClientMessageProvider,
  EmailProvider,
  EmailSendParams,
  TelegramProvider,
  TelegramSendParams,
} from '../../src/modules/notifications/providers/types.js';
import { registerReminderOutboxHooks } from '../../src/modules/notifications/reminders.service.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

async function seedMasterSchedule(userId: string) {
  await prisma.workingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      userId,
      dayOfWeek,
      startTime: '09:00',
      endTime: '18:00',
    })),
  });
}

async function linkMasterService(userId: string, serviceId: string) {
  await prisma.masterService.create({
    data: { userId, serviceId },
  });
}

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

class FakeEmailProvider implements EmailProvider {
  readonly sent: EmailSendParams[] = [];

  send(params: EmailSendParams): Promise<void> {
    this.sent.push(params);
    return Promise.resolve();
  }
}

class FakeTelegramProvider implements TelegramProvider {
  readonly sent: TelegramSendParams[] = [];

  send(params: TelegramSendParams): Promise<void> {
    this.sent.push(params);
    return Promise.resolve();
  }
}

class FakeClientMessageProvider implements ClientMessageProvider {
  readonly name = 'fake-client';
  readonly isConfigured = true;
  readonly sent: Array<{ channel: 'SMS' | 'WHATSAPP'; to: string; text: string }> = [];

  send(params: { channel: 'SMS' | 'WHATSAPP'; to: string; text: string }): Promise<void> {
    this.sent.push(params);
    return Promise.resolve();
  }
}

async function createPlanAndSubscription(
  companyId: string,
  options: {
    featureAutoReminders?: boolean;
    maxRemindersPerMonth?: number | null;
    periodEndsAt?: Date;
  } = {},
) {
  const plan = await prisma.plan.create({
    data: {
      code: `p20-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: 'Pro Plan',
      priceMonthly: 1500,
      maxStaff: 10,
      featureAnalytics: true,
      featureAutoReminders: options.featureAutoReminders ?? true,
      featurePrepayment: false,
      maxRemindersPerMonth:
        options.maxRemindersPerMonth !== undefined ? options.maxRemindersPerMonth : 100,
      isPublic: false,
      isActive: true,
    },
  });

  await prisma.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      isTrial: false,
      periodStartsAt: DateTime.fromISO('2026-11-01T00:00:00.000Z').toJSDate(),
      periodEndsAt: options.periodEndsAt ?? DateTime.fromISO('2026-12-01T00:00:00.000Z').toJSDate(),
      status: 'ACTIVE',
    },
  });
}

describe('Phase 20: Staff notifications, Telegram linking & client reminders', () => {
  const app = createApp();
  let fakeEmail: FakeEmailProvider;
  let fakeTelegram: FakeTelegramProvider;
  let fakeClient: FakeClientMessageProvider;
  let origWebhookSecret: string;
  let origBotUsername: string;

  beforeEach(async () => {
    await truncateAllTables();
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p20-plan-' } } });
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'plan-' } } });
    origWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
    origBotUsername = env.TELEGRAM_BOT_USERNAME;
    env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
    env.TELEGRAM_BOT_USERNAME = 'zapis_test_bot';

    fakeEmail = new FakeEmailProvider();
    fakeTelegram = new FakeTelegramProvider();
    fakeClient = new FakeClientMessageProvider();
    setProviderRegistry({
      email: fakeEmail,
      telegram: fakeTelegram,
      clientMessage: fakeClient,
    });
    registerReminderOutboxHooks();
  });

  afterEach(async () => {
    resetClock();
    resetProviderRegistry();
    env.TELEGRAM_WEBHOOK_SECRET = origWebhookSecret;
    env.TELEGRAM_BOT_USERNAME = origBotUsername;
    await prisma.subscription.deleteMany({});
    await prisma.plan.deleteMany({ where: { code: { startsWith: 'p20-plan-' } } });
  });

  it('routes staff notifications with owner/master deduplication and respects user channel toggles', async () => {
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory({
      slug: 'dedup-salon',
      reminderMode: ReminderMode.OFF,
    });
    await createPlanAndSubscription(company.id);

    const ownerMaster = await createUserFactory(company.id, {
      role: Role.OWNER,
      isBookable: true,
      email: 'owner@test.kg',
      notifyEmail: true,
      notifyTelegram: true,
      telegramChatId: 'chat-owner-1',
    });
    const otherMaster = await createUserFactory(company.id, {
      role: Role.MASTER,
      isBookable: true,
      email: 'master@test.kg',
      notifyEmail: false,
      notifyTelegram: true,
      telegramChatId: 'chat-master-2',
    });
    await seedMasterSchedule(ownerMaster.id);
    await seedMasterSchedule(otherMaster.id);

    const service = await createServiceFactory(company.id, {
      durationMin: 60,
      price: new Prisma.Decimal('1000.00'),
    });
    await linkMasterService(ownerMaster.id, service.id);
    await linkMasterService(otherMaster.id, service.id);

    // 1. Public booking for ownerMaster -> deduplicated to 1 in-app, 1 email, 1 telegram
    const pub1 = await request(app).post('/api/v1/public/companies/dedup-salon/appointments').send({
      serviceId: service.id,
      masterId: ownerMaster.id,
      startAt: '2026-11-21T08:00:00.000Z',
      clientName: 'Азамат',
      clientPhone: '+996555111222',
      consentAccepted: true,
    });
    expect(pub1.status).toBe(201);
    const pub1Data = asBody<DataEnvelope<{ manageUrl: string; appointment: { id: string } }>>(
      pub1.body,
    ).data;
    const pub1Token = pub1Data.manageUrl.split('/manage/')[1] ?? '';

    const inAppForOwner = await prisma.inAppNotification.findMany({
      where: { companyId: company.id, userId: ownerMaster.id },
    });
    expect(inAppForOwner).toHaveLength(1);
    expect(inAppForOwner[0]?.kind).toBe('NEW_ONLINE_BOOKING');

    const outbox1 = await prisma.outboxMessage.findMany({
      where: { companyId: company.id, appointmentId: pub1Data.appointment.id },
    });
    expect(outbox1).toHaveLength(2); // 1 EMAIL + 1 TELEGRAM

    // 2. Staff booking created by owner for otherMaster -> STAFF_BOOKING_FOR_MASTER (telegram only, email off)
    const ownerToken = signAccessToken({
      sub: ownerMaster.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: ownerMaster.tokenVersion,
    });
    const staffBooking = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        serviceId: service.id,
        masterId: otherMaster.id,
        startAt: '2026-11-21T10:00:00.000Z',
        clientName: 'Бекзат',
        clientPhone: '+996555333444',
      });
    expect(staffBooking.status).toBe(201);
    const staffBookingId = asBody<DataEnvelope<{ id: string }>>(staffBooking.body).data.id;

    const outboxStaff = await prisma.outboxMessage.findMany({
      where: { companyId: company.id, appointmentId: staffBookingId },
    });
    expect(outboxStaff).toHaveLength(1);
    expect(outboxStaff[0]?.channel).toBe(NotificationChannel.TELEGRAM);
    expect(outboxStaff[0]?.kind).toBe('STAFF_BOOKING_FOR_MASTER');

    // 3. Client reschedule & cancel -> notifies owner + master
    const reschedRes = await request(app)
      .post(`/api/v1/public/manage/${pub1Token}/reschedule`)
      .send({ startAt: '2026-11-21T09:00:00.000Z' });
    expect(reschedRes.status).toBe(200);

    const cancelRes = await request(app).post(`/api/v1/public/manage/${pub1Token}/cancel`).send({});
    expect(cancelRes.status).toBe(200);

    const ownerNotifs = await prisma.inAppNotification.findMany({
      where: { companyId: company.id, userId: ownerMaster.id },
    });
    expect(ownerNotifs.map((n) => n.kind).sort()).toEqual([
      'CLIENT_CANCELLED',
      'CLIENT_RESCHEDULED',
      'NEW_ONLINE_BOOKING',
    ]);
  });

  it('links and unlinks Telegram via link-code, webhook secret check, duplicate chatId guard, and /stop', async () => {
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory();
    const user1 = await createUserFactory(company.id, { role: Role.OWNER });
    const user2 = await createUserFactory(company.id, { role: Role.MASTER });

    const token1 = signAccessToken({
      sub: user1.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: user1.tokenVersion,
    });
    const token2 = signAccessToken({
      sub: user2.id,
      companyId: company.id,
      role: Role.MASTER,
      tv: user2.tokenVersion,
    });

    // Generate link code for user1
    const codeRes = await request(app)
      .post('/api/v1/me/telegram/link-code')
      .set('Authorization', `Bearer ${token1}`)
      .send({});
    expect(codeRes.status).toBe(200);
    const { code, deepLink } = asBody<DataEnvelope<{ code: string; deepLink: string | null }>>(
      codeRes.body,
    ).data;
    expect(deepLink).toBe(`https://t.me/zapis_test_bot?start=${code}`);

    // Wrong webhook secret -> 403
    const badSecret = await request(app)
      .post('/api/v1/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'wrong-secret')
      .send({ message: { chat: { id: 998877 }, text: `/start ${code}` } });
    expect(badSecret.status).toBe(403);

    // Valid webhook secret -> links user1
    const goodHook = await request(app)
      .post('/api/v1/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'test-webhook-secret')
      .send({ message: { chat: { id: 998877 }, text: `/start ${code}` } });
    expect(goodHook.status).toBe(200);

    const settings1 = await request(app)
      .get('/api/v1/me/notification-settings')
      .set('Authorization', `Bearer ${token1}`);
    expect(settings1.status).toBe(200);
    expect(
      asBody<DataEnvelope<{ telegramConnected: boolean }>>(settings1.body).data.telegramConnected,
    ).toBe(true);
    expect(fakeTelegram.sent.length).toBe(0);
    await runOutboxDispatcherOnce();
    expect(fakeTelegram.sent.length).toBeGreaterThanOrEqual(1);

    // Duplicate chatId attempt for user2 -> rejected, user1 stays linked
    const code2Res = await request(app)
      .post('/api/v1/me/telegram/link-code')
      .set('Authorization', `Bearer ${token2}`)
      .send({});
    const code2 = asBody<DataEnvelope<{ code: string }>>(code2Res.body).data.code;
    await request(app)
      .post('/api/v1/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'test-webhook-secret')
      .send({ message: { chat: { id: 998877 }, text: `/start ${code2}` } });

    const settings2 = await request(app)
      .get('/api/v1/me/notification-settings')
      .set('Authorization', `Bearer ${token2}`);
    expect(
      asBody<DataEnvelope<{ telegramConnected: boolean }>>(settings2.body).data.telegramConnected,
    ).toBe(false);

    // /stop unlinks user1
    await request(app)
      .post('/api/v1/telegram/webhook')
      .set('x-telegram-bot-api-secret-token', 'test-webhook-secret')
      .send({ message: { chat: { id: 998877 }, text: '/stop' } });

    const settings1AfterStop = await request(app)
      .get('/api/v1/me/notification-settings')
      .set('Authorization', `Bearer ${token1}`);
    expect(
      asBody<DataEnvelope<{ telegramConnected: boolean }>>(settings1AfterStop.body).data
        .telegramConnected,
    ).toBe(false);
  });

  it('schedules reminders according to lead time & quiet hours, and rebuilds on reschedule/cancel', async () => {
    // 2026-11-20 06:00 UTC = 12:00 Asia/Bishkek
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory({
      slug: 'rem-salon',
      reminderMode: ReminderMode.AUTO,
      remind24h: true,
      remind2h: true,
      defaultLocale: Locale.KY,
    });
    await createPlanAndSubscription(company.id, { featureAutoReminders: true });

    const master = await createUserFactory(company.id, { role: Role.MASTER, isBookable: true });
    await seedMasterSchedule(master.id);
    const service = await createServiceFactory(company.id, { durationMin: 60 });
    await linkMasterService(master.id, service.id);

    // 1. Booking in 29h (2026-11-21 11:00 UTC = 17:00 Bishkek) -> 24h & 2h scheduled
    const r30 = await request(app).post('/api/v1/public/companies/rem-salon/appointments').send({
      serviceId: service.id,
      masterId: master.id,
      startAt: '2026-11-21T11:00:00.000Z',
      clientName: 'Айгуль',
      clientPhone: '+996555222333',
      consentAccepted: true,
      locale: 'KY',
    });
    expect(r30.status).toBe(201);
    const id30 = asBody<DataEnvelope<{ manageUrl: string; appointment: { id: string } }>>(
      r30.body,
    ).data;
    const token30 = id30.manageUrl.split('/manage/')[1] ?? '';

    const rem30 = await prisma.outboxMessage.findMany({
      where: { appointmentId: id30.appointment.id, kind: { in: ['REMINDER_24H', 'REMINDER_2H'] } },
      orderBy: { kind: 'asc' },
    });
    expect(rem30).toHaveLength(2);

    // 2. Booking in 10h (2026-11-20 16:00 UTC = 22:00 Bishkek -> 2h reminder = 20:00 Bishkek, not quiet)
    // Wait: 22:00 Bishkek is outside default 09-18 schedule, so create via factory or use 06:00 UTC + 10h?
    // Let's seed a 24h schedule or test 03:00 UTC (09:00 Bishkek) -> 10h later is 19:00 Bishkek? No, seedMasterSchedule is 09:00-18:00.
    // At 02:00 UTC (08:00 Bishkek), 10h later is 18:00 Bishkek -> within 09-18? End=18:00, 60m service fits at 17:00 Bishkek (9h later = 11:00 UTC)!
    setClock(new FakeClock('2026-11-20T02:00:00.000Z')); // 08:00 Bishkek
    const r9 = await request(app).post('/api/v1/public/companies/rem-salon/appointments').send({
      serviceId: service.id,
      masterId: master.id,
      startAt: '2026-11-20T11:00:00.000Z', // 17:00 Bishkek (9h ahead)
      clientName: 'Канат',
      clientPhone: '+996555444555',
      consentAccepted: true,
    });
    expect(r9.status).toBe(201);
    const id9 = asBody<DataEnvelope<{ appointment: { id: string } }>>(r9.body).data.appointment.id;
    const rem9 = await prisma.outboxMessage.findMany({
      where: { appointmentId: id9, kind: { in: ['REMINDER_24H', 'REMINDER_2H'] } },
    });
    expect(rem9).toHaveLength(1);
    expect(rem9[0]?.kind).toBe('REMINDER_2H');

    // 3. Booking in 90m (08:00 Bishkek -> 09:30 Bishkek = 03:30 UTC) -> 0 reminders
    const r90m = await request(app).post('/api/v1/public/companies/rem-salon/appointments').send({
      serviceId: service.id,
      masterId: master.id,
      startAt: '2026-11-20T03:30:00.000Z',
      clientName: 'Марат',
      clientPhone: '+996555666777',
      consentAccepted: true,
    });
    expect(r90m.status).toBe(201);
    const id90m = asBody<DataEnvelope<{ appointment: { id: string } }>>(r90m.body).data.appointment
      .id;
    const rem90m = await prisma.outboxMessage.findMany({
      where: { appointmentId: id90m, kind: { in: ['REMINDER_24H', 'REMINDER_2H'] } },
    });
    expect(rem90m).toHaveLength(0);

    // 4. Quiet hours: booking at 09:00 Bishkek next day (2026-11-21 03:00 UTC) ->
    //    24h reminder is 09:00 Bishkek today (not quiet),
    //    2h reminder is 07:00 Bishkek next day (quiet 22:00-08:00) -> shifted to 08:00 Bishkek (60m before startAt >= 30m)
    const rQuiet = await request(app).post('/api/v1/public/companies/rem-salon/appointments').send({
      serviceId: service.id,
      masterId: master.id,
      startAt: '2026-11-21T03:00:00.000Z', // 09:00 Bishkek
      clientName: 'Сабира',
      clientPhone: '+996555888999',
      consentAccepted: true,
    });
    expect(rQuiet.status).toBe(201);
    const idQuiet = asBody<DataEnvelope<{ appointment: { id: string } }>>(rQuiet.body).data
      .appointment.id;
    const remQuiet2h = await prisma.outboxMessage.findFirst({
      where: { appointmentId: idQuiet, kind: 'REMINDER_2H' },
    });
    expect(remQuiet2h?.scheduledFor.toISOString()).toBe('2026-11-21T02:00:00.000Z'); // 08:00 Bishkek

    // 5. Reschedule cancels old pending reminders & creates new ones; cancel cancels pending
    await request(app)
      .post(`/api/v1/public/manage/${token30}/reschedule`)
      .send({ startAt: '2026-11-21T10:00:00.000Z' });
    const pendingAfterResched = await prisma.outboxMessage.findMany({
      where: {
        appointmentId: id30.appointment.id,
        kind: { in: ['REMINDER_24H', 'REMINDER_2H'] },
        status: OutboxStatus.PENDING,
      },
    });
    expect(pendingAfterResched).toHaveLength(2);

    await request(app).post(`/api/v1/public/manage/${token30}/cancel`).send({});
    const pendingAfterCancel = await prisma.outboxMessage.findMany({
      where: {
        appointmentId: id30.appointment.id,
        kind: { in: ['REMINDER_24H', 'REMINDER_2H'] },
        status: OutboxStatus.PENDING,
      },
    });
    expect(pendingAfterCancel).toHaveLength(0);
  });

  it('enforces send-time recheck, plan reminder cap, mode switch gating, and MANUAL queue', async () => {
    setClock(new FakeClock('2026-11-20T06:00:00.000Z'));

    const company = await createCompanyFactory({
      slug: 'cap-salon',
      reminderMode: ReminderMode.MANUAL,
      remind24h: true,
      remind2h: true,
    });
    await createPlanAndSubscription(company.id, {
      featureAutoReminders: true,
      maxRemindersPerMonth: 1,
    });

    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    await seedMasterSchedule(owner.id);
    const service = await createServiceFactory(company.id, { durationMin: 60 });

    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    // 1. Create appointment while MANUAL -> appears in /reminders/queue
    const appt1 = await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      startAt: DateTime.fromISO('2026-11-21T06:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-21T07:00:00.000Z').toJSDate(),
      source: AppointmentSource.STAFF,
      status: AppointmentStatus.SCHEDULED,
      clientName: 'Руслан',
      clientPhone: '+996555777888',
    });

    const queueBefore = await request(app)
      .get('/api/v1/reminders/queue')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(queueBefore.status).toBe(200);
    const qData = asBody<
      DataEnvelope<{
        reminderMode: string;
        items: Array<{ id: string; whatsappUrl: string }>;
      }>
    >(queueBefore.body).data;
    expect(qData.reminderMode).toBe('MANUAL');
    expect(qData.items).toHaveLength(1);
    expect(qData.items[0]?.whatsappUrl).toContain('https://wa.me/996555777888?text=');

    // Mark reminder sent -> disappears from pending queue
    const markRes = await request(app)
      .post(`/api/v1/appointments/${appt1.id}/reminder-sent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(markRes.status).toBe(200);

    const queueAfter = await request(app)
      .get('/api/v1/reminders/queue')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(asBody<DataEnvelope<{ items: unknown[] }>>(queueAfter.body).data.items).toHaveLength(0);

    // 2. Switch to AUTO -> backfills upcoming scheduled appointments
    const appt2 = await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      startAt: DateTime.fromISO('2026-11-21T10:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-21T11:00:00.000Z').toJSDate(),
      status: AppointmentStatus.SCHEDULED,
      clientName: 'Динара',
      clientPhone: '+996555999000',
    });

    const switchAuto = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reminderMode: 'AUTO' });
    expect(switchAuto.status).toBe(200);

    const backfilled = await prisma.outboxMessage.findMany({
      where: {
        companyId: company.id,
        appointmentId: appt2.id,
        kind: { in: ['REMINDER_24H', 'REMINDER_2H'] },
      },
    });
    expect(backfilled.length).toBeGreaterThanOrEqual(1);

    // 3. Dispatch when 24h reminder due, cap=1 -> first sends, second skips + owner gets PLAN_REMINDER_CAP_REACHED
    // Advance clock to 2026-11-21T08:05:00.000Z (both 24h and 2h due)
    setClock(new FakeClock('2026-11-21T08:05:00.000Z'));
    await runOutboxDispatcherOnce();

    expect(fakeClient.sent).toHaveLength(1);
    const capNotif = await prisma.inAppNotification.findMany({
      where: { companyId: company.id, userId: owner.id, kind: 'PLAN_REMINDER_CAP_REACHED' },
    });
    expect(capNotif).toHaveLength(1);

    // 4. Plan without featureAutoReminders -> 402 FEATURE_NOT_IN_PLAN
    await prisma.plan.updateMany({
      where: { code: { startsWith: 'p20-plan-' } },
      data: { featureAutoReminders: false },
    });
    const freshOwnerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });
    const blockedSwitch = await request(app)
      .patch('/api/v1/company')
      .set('Authorization', `Bearer ${freshOwnerToken}`)
      .send({ reminderMode: 'AUTO' });
    expect(blockedSwitch.status).toBe(402);
    expect(asBody<ErrorEnvelope>(blockedSwitch.body).error.code).toBe('FEATURE_NOT_IN_PLAN');
  });
});
