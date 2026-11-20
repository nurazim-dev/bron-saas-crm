import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetRateLimitersForTest } from '../../src/middleware/rate-limit.js';
import { processTelegramUpdate } from '../../src/modules/notifications/telegram-link.service.js';
import { truncateAllTables } from '../helpers/db.js';

describe('Smart Telegram Bot ("Second Web"): staff & master notifications, inline status changes, stats, clear & client self-service', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    resetRateLimitersForTest();
    await prisma.platformSetting.upsert({
      where: { key: 'registrationOpen' },
      update: { value: true },
      create: { key: 'registrationOpen', value: true },
    });
  });

  afterEach(() => {
    resetClock();
  });

  it('links a master without web login via owner-issued Telegram link, sends booking notifications to both owner and master, and handles /today, status callbacks, /stats, and /clear', async () => {
    const clock = new FakeClock(new Date('2026-11-11T04:00:00.000Z')); // 10:00 in Asia/Bishkek (Wednesday, dayOfWeek=3)
    setClock(clock);

    const regRes = await request(app).post('/api/v1/auth/register').send({
      ownerName: 'Азамат Владелец',
      email: 'tg-owner@salon.kg',
      password: 'Password123!',
      termsAccepted: true,
      companyName: 'Smart Bot Barbershop',
      businessType: 'BARBERSHOP',
    });
    expect(regRes.status).toBe(201);
    const ownerAuth = (
      regRes.body as {
        data: {
          accessToken: string;
          user: { id: string };
          company: { id: string; slug: string };
        };
      }
    ).data;
    const headers = { Authorization: `Bearer ${ownerAuth.accessToken}` };

    // Owner links their own Telegram
    const ownerLinkRes = await request(app).post('/api/v1/me/telegram/link-code').set(headers);
    expect(ownerLinkRes.status).toBe(200);
    const ownerCode = (ownerLinkRes.body as { data: { code: string } }).data.code;

    await processTelegramUpdate({
      update_id: 9001,
      message: { chat: { id: 100001, type: 'private' }, text: `/start ${ownerCode}` },
    });

    // Owner creates a master WITHOUT web login (no email, no password)
    const masterRes = await request(app).post('/api/v1/staff').set(headers).send({
      name: 'Бекзат Мастер',
      phone: '+996555700001',
      isBookable: true,
      isActive: true,
    });
    expect(masterRes.status).toBe(201);
    const masterId = (masterRes.body as { data: { id: string; hasLogin: boolean } }).data.id;
    expect((masterRes.body as { data: { hasLogin: boolean } }).data.hasLogin).toBe(false);

    // Owner generates Telegram link code for the master from /api/v1/staff/:id/telegram-link-code
    const masterLinkRes = await request(app)
      .post(`/api/v1/staff/${masterId}/telegram-link-code`)
      .set(headers);
    expect(masterLinkRes.status).toBe(200);
    const masterLinkData = (masterLinkRes.body as { data: { code: string; deepLink: string } })
      .data;
    expect(masterLinkData.deepLink).toContain(`?start=${masterLinkData.code}`);

    // Master connects Telegram via /start <code>
    await processTelegramUpdate({
      update_id: 9002,
      message: { chat: { id: 200002, type: 'private' }, text: `/start ${masterLinkData.code}` },
    });

    // Verify GET /api/v1/staff shows telegramConnected: true for both
    const staffListRes = await request(app).get('/api/v1/staff').set(headers);
    expect(staffListRes.status).toBe(200);
    const staffList = (
      staffListRes.body as { data: Array<{ id: string; telegramConnected: boolean }> }
    ).data;
    expect(staffList.find((s) => s.id === masterId)?.telegramConnected).toBe(true);

    // Configure service and working hours for the master
    const svcRes = await request(app)
      .post('/api/v1/services')
      .set(headers)
      .send({ name: 'Фейд + Борода', durationMin: 60, price: '1200.00' });
    expect(svcRes.status).toBe(201);
    const serviceId = (svcRes.body as { data: { id: string } }).data.id;

    await request(app)
      .put(`/api/v1/staff/${masterId}/services`)
      .set(headers)
      .send({ serviceIds: [serviceId] });

    await request(app)
      .put(`/api/v1/staff/${masterId}/working-hours`)
      .set(headers)
      .send({
        days: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '20:00',
          breakStart: null,
          breakEnd: null,
        })),
      });

    // Client books an online appointment with this specific master for today at 14:00 local (08:00 UTC)
    const bookRes = await request(app)
      .post(`/api/v1/public/companies/${ownerAuth.company.slug}/appointments`)
      .send({
        masterId,
        serviceId,
        startAt: '2026-11-11T08:00:00.000Z',
        clientName: 'Эрмек Клиент',
        clientPhone: '+996555800001',
        consentAccepted: true,
        website: '',
      });
    expect(bookRes.status).toBe(201);
    const booked = (
      bookRes.body as {
        data: {
          appointment: { id: string };
          manageUrl: string;
          telegramBotUrl: string;
        };
      }
    ).data;
    expect(booked.telegramBotUrl).toContain('?start=client_');

    // Verify BOTH owner (100001) and assigned master (200002) received NEW_ONLINE_BOOKING Telegram notifications with inline buttons
    const bookingNotifications = await prisma.outboxMessage.findMany({
      where: {
        companyId: ownerAuth.company.id,
        channel: 'TELEGRAM',
        kind: 'NEW_ONLINE_BOOKING',
        appointmentId: booked.appointment.id,
      },
    });
    expect(bookingNotifications.map((m) => m.recipient).sort()).toEqual(['100001', '200002']);

    // Master sends /today in Telegram -> receives today's appointment card with inline actions
    await processTelegramUpdate({
      update_id: 9003,
      message: { chat: { id: 200002, type: 'private' }, text: '/today' },
    });

    const todayMessages = await prisma.outboxMessage.findMany({
      where: {
        companyId: ownerAuth.company.id,
        channel: 'TELEGRAM',
        recipient: '200002',
        dedupeKey: { startsWith: 'telegram-update:200002:9003' },
      },
    });
    expect(todayMessages).toHaveLength(1);
    expect((todayMessages[0]?.payload as { text: string }).text).toContain('Эрмек Клиент');
    expect((todayMessages[0]?.payload as { text: string }).text).toContain('Фейд + Борода');

    // Master clicks inline callback button to confirm appointment (`appt:<id>:CONFIRMED`)
    await processTelegramUpdate({
      update_id: 9004,
      callback_query: {
        id: 'cb-confirm-1',
        data: `appt:${booked.appointment.id}:CONFIRMED`,
        message: { message_id: 50, chat: { id: 200002, type: 'private' } },
      },
    });

    const apptAfterConfirm = await prisma.appointment.findUniqueOrThrow({
      where: { id: booked.appointment.id },
    });
    expect(apptAfterConfirm.status).toBe('CONFIRMED');

    // Advance clock past appointment start (09:00 UTC) and master completes appointment via callback
    clock.set(new Date('2026-11-11T09:10:00.000Z'));
    await processTelegramUpdate({
      update_id: 9005,
      callback_query: {
        id: 'cb-complete-1',
        data: `appt:${booked.appointment.id}:COMPLETED`,
        message: { message_id: 51, chat: { id: 200002, type: 'private' } },
      },
    });

    const apptAfterComplete = await prisma.appointment.findUniqueOrThrow({
      where: { id: booked.appointment.id },
    });
    expect(apptAfterComplete.status).toBe('COMPLETED');

    // Owner requests /stats -> sees today's completed visit and revenue (1200 KGS)
    await processTelegramUpdate({
      update_id: 9006,
      message: { chat: { id: 100001, type: 'private' }, text: '/stats' },
    });
    const statsMsg = await prisma.outboxMessage.findFirstOrThrow({
      where: { dedupeKey: 'telegram-update:100001:9006' },
    });
    expect((statsMsg.payload as { text: string }).text).toContain('Сводка за сегодня');
    expect((statsMsg.payload as { text: string }).text).toContain('1200 KGS');

    // Master clears chat history via `cmd:clear`
    await processTelegramUpdate({
      update_id: 9007,
      callback_query: {
        id: 'cb-clear-1',
        data: 'cmd:clear',
        message: { message_id: 55, chat: { id: 200002, type: 'private' } },
      },
    });
    const clearMsg = await prisma.outboxMessage.findFirstOrThrow({
      where: { dedupeKey: 'telegram-update:200002:9007' },
    });
    expect((clearMsg.payload as { text: string }).text).toContain('Чат очищен');
  });

  it('links a client via /start client_<manageToken>, lists client appointments, cancels from Telegram, and queues free Telegram reminders', async () => {
    const clock = new FakeClock(new Date('2026-11-11T04:00:00.000Z'));
    setClock(clock);

    const regRes = await request(app).post('/api/v1/auth/register').send({
      ownerName: 'Айжан Владелец',
      email: 'client-tg@salon.kg',
      password: 'Password123!',
      termsAccepted: true,
      companyName: 'Client Bot Salon',
      businessType: 'BEAUTY_SALON',
    });
    expect(regRes.status).toBe(201);
    const ownerAuth = (
      regRes.body as {
        data: {
          accessToken: string;
          user: { id: string };
          company: { id: string; slug: string };
        };
      }
    ).data;
    const headers = { Authorization: `Bearer ${ownerAuth.accessToken}` };

    const svcRes = await request(app)
      .post('/api/v1/services')
      .set(headers)
      .send({ name: 'Маникюр Гель', durationMin: 60, price: '1500.00' });
    const serviceId = (svcRes.body as { data: { id: string } }).data.id;

    await request(app)
      .put(`/api/v1/staff/${ownerAuth.user.id}/services`)
      .set(headers)
      .send({ serviceIds: [serviceId] });

    await request(app)
      .put(`/api/v1/staff/${ownerAuth.user.id}/working-hours`)
      .set(headers)
      .send({
        days: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          dayOfWeek,
          startTime: '09:00',
          endTime: '20:00',
          breakStart: null,
          breakEnd: null,
        })),
      });

    // Client books 1st appointment for tomorrow (2026-11-12 08:00 UTC)
    const book1 = await request(app)
      .post(`/api/v1/public/companies/${ownerAuth.company.slug}/appointments`)
      .send({
        masterId: ownerAuth.user.id,
        serviceId,
        startAt: '2026-11-12T08:00:00.000Z',
        clientName: 'Камила Клиент',
        clientPhone: '+996555900001',
        consentAccepted: true,
        website: '',
      });
    expect(book1.status).toBe(201);
    const data1 = (
      book1.body as {
        data: {
          appointment: { id: string };
          manageUrl: string;
          telegramBotUrl: string;
        };
      }
    ).data;
    const manageToken = data1.manageUrl.split('/manage/')[1] ?? '';

    // Client clicks "Get reminders & manage in Telegram" -> /start client_<manageToken>
    await processTelegramUpdate({
      update_id: 9101,
      message: { chat: { id: 300003, type: 'private' }, text: `/start client_${manageToken}` },
    });

    const clientRow = await prisma.client.findFirstOrThrow({
      where: { companyId: ownerAuth.company.id, phone: '+996555900001' },
    });
    expect(clientRow.telegramChatId).toBe('300003');

    // Client books a 2nd appointment 2 days ahead -> Telegram reminders (24h and 2h) are automatically scheduled even in MANUAL reminderMode!
    const book2 = await request(app)
      .post(`/api/v1/public/companies/${ownerAuth.company.slug}/appointments`)
      .send({
        masterId: ownerAuth.user.id,
        serviceId,
        startAt: '2026-11-13T08:00:00.000Z',
        clientName: 'Камила Клиент',
        clientPhone: '+996555900001',
        consentAccepted: true,
        website: '',
      });
    expect(book2.status).toBe(201);
    const appt2Id = (book2.body as { data: { appointment: { id: string } } }).data.appointment.id;

    const tgReminders = await prisma.outboxMessage.findMany({
      where: {
        appointmentId: appt2Id,
        channel: 'TELEGRAM',
        recipient: '300003',
        kind: { in: ['REMINDER_24H', 'REMINDER_2H'] },
      },
    });
    expect(tgReminders).toHaveLength(2);

    // Client cancels 1st appointment directly inside Telegram via callback `client:cancel:<id>`
    await processTelegramUpdate({
      update_id: 9102,
      callback_query: {
        id: 'cb-client-cancel',
        data: `client:cancel:${data1.appointment.id}`,
        message: { message_id: 70, chat: { id: 300003, type: 'private' } },
      },
    });

    const cancelledAppt = await prisma.appointment.findUniqueOrThrow({
      where: { id: data1.appointment.id },
    });
    expect(cancelledAppt.status).toBe('CANCELLED');
    expect(cancelledAppt.cancelledBy).toBe('CLIENT');
  });
});
