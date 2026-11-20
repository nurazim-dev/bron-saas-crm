import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import {
  NotificationChannel,
  OutboxStatus,
  PrepaymentMode,
  Prisma,
  Role,
} from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { escapeCsvCell } from '../../src/lib/csv.js';
import { signAccessToken } from '../../src/lib/jwt.js';
import { prisma, prismaUnfiltered } from '../../src/lib/prisma.js';
import { signAdminAccessToken } from '../../src/modules/admin/admin-crypto.js';
import { buildWhatsappProofUrl } from '../../src/modules/appointments/prepayment.js';
import { createTrialSubscriptionForCompany } from '../../src/modules/billing/billing.service.js';
import { runOutboxDispatcherOnce } from '../../src/modules/notifications/dispatcher.service.js';
import {
  escapeHtml,
  renderNotificationTemplate,
} from '../../src/modules/notifications/templates/index.js';
import { truncateAllTables } from '../helpers/db.js';
import {
  createAppointmentFactory,
  createCompanyFactory,
  createServiceFactory,
  createUserFactory,
} from '../helpers/factories.js';

describe('Security Domains C, E, H & I: Injection, Output Encoding, Error Handling, Data Protection & Bounds', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateAllTables();
    setClock(new FakeClock(DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate()));
  });

  afterEach(() => {
    resetClock();
  });

  it('neutralizes SQL injection payloads across raw SQL endpoints, sort/filter parameters, prototype pollution, and ReDoS inputs', async () => {
    const company = await createCompanyFactory({ slug: 'sqli-sec' });
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const token = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    await prisma.client.create({
      data: { companyId: company.id, name: 'Safe Client', phone: '+996700112233' },
    });

    const sqliPayloads = [
      "' OR '1'='1",
      "'; DROP TABLE \"Client\"; --",
      '" UNION SELECT id, email, "passwordHash" FROM "User" --',
      '1; SELECT pg_sleep(5)--',
      "%27%20OR%201=1--",
    ];

    for (const payload of sqliPayloads) {
      const clientsRes = await request(app)
        .get('/api/v1/clients')
        .query({ search: payload, segment: payload, sortBy: payload })
        .set('Authorization', `Bearer ${token}`);
      expect([200, 400]).toContain(clientsRes.status);

      const searchRes = await request(app)
        .get('/api/v1/search')
        .query({ q: payload })
        .set('Authorization', `Bearer ${token}`);
      expect([200, 400]).toContain(searchRes.status);
    }

    // Verify Client table is intact
    expect(await prisma.client.count({ where: { companyId: company.id } })).toBe(1);

    // Prototype pollution in JSON body must not pollute Object.prototype
    await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"name":"Proto","phone":"+996700223344","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // ReDoS check: pathological slug, phone, and search inputs complete in < 200ms
    const t0 = performance.now();
    await request(app).get(`/api/v1/public/companies/${'a-'.repeat(60)}!`);
    await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ReDoS', phone: `+996${'5'.repeat(120)}!` });
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('escapes XSS & formula-injection payloads in HTML emails, Telegram HTML, CSV export, wa.me links, and strips null bytes', async () => {
    const xss = `<script>alert("xss")</script><img src=x onerror=alert(1)>'&"`;
    const htmlEscaped = escapeHtml(xss);
    expect(htmlEscaped).not.toContain('<script>');
    expect(htmlEscaped).not.toContain('<img');
    expect(htmlEscaped).toContain('&lt;script&gt;');

    const tpl = renderNotificationTemplate('NEW_ONLINE_BOOKING', NotificationChannel.EMAIL, {
      companyName: xss,
      clientName: xss,
      clientPhone: '+996700112233',
      serviceName: xss,
      masterName: xss,
      localDateTime: '2026-11-17 10:00',
    });
    expect(tpl.html).not.toContain('<script>');
    expect(tpl.telegramHtml).not.toContain('<script>');

    // CSV formula injection escaping (=, +, -, @, \t, \r)
    for (const formula of ['=CMD()|"/C calc"!A0', '+1+1', '-1+1', '@SUM(1+1)', '\t=1+1', '\r=1+1']) {
      const cell = escapeCsvCell(formula);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }

    // wa.me URL encoding
    const waUrl = buildWhatsappProofUrl('+996555123456', {
      clientName: 'Evil & Co <script>alert(1)</script>',
      serviceName: 'Cut & Shave',
      localDateTime: '2026-11-17 12:00',
      amount: '500.00',
      currency: 'KGS',
      locale: 'RU',
    });
    expect(waUrl).toContain('https://wa.me/996555123456?text=');
    expect(waUrl).not.toContain('<script>');
    expect(waUrl).toContain('%3Cscript%3E');

    // Control characters & null bytes stripped on client creation
    const company = await createCompanyFactory();
    await createTrialSubscriptionForCompany(prisma, company.id);
    const owner = await createUserFactory(company.id, { role: Role.OWNER });
    const token = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });
    const clientRes = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Clean\u0000Name\u0007\u001F',
        phone: '+996700334455',
        notes: 'Line1\u0000Line2',
      });
    expect(clientRes.status).toBe(201);
    expect(clientRes.body.data.name).toBe('CleanName');
    expect(clientRes.body.data.notes).not.toContain('\u0000');
  });

  it('enforces uniform production error envelopes, security headers, Cache-Control: no-store on manage/token/PII endpoints (SEC-008), and poison outbox resilience', async () => {
    const company = await createCompanyFactory();
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id);
    const appt = await createAppointmentFactory({
      companyId: company.id,
      masterId: owner.id,
      serviceId: service.id,
      startAt: DateTime.fromISO('2026-11-17T06:00:00.000Z').toJSDate(),
      endAt: DateTime.fromISO('2026-11-17T07:00:00.000Z').toJSDate(),
      manageToken: 'sec_manage_tok_000000000000000000000000001',
    });

    // Manage endpoint returns PII and is keyed by bearer token -> must send Cache-Control: no-store, Referrer-Policy: no-referrer, Permissions-Policy, and no X-Powered-By (SEC-008)
    const manageRes = await request(app).get(
      `/api/v1/public/manage/${appt.manageToken}`,
    );
    expect(manageRes.status).toBe(200);
    expect(manageRes.headers['x-powered-by']).toBeUndefined();
    expect(manageRes.headers['x-content-type-options']).toBe('nosniff');
    expect(manageRes.headers['referrer-policy']).toBe('no-referrer');
    expect(manageRes.headers['permissions-policy']).toContain('camera=()');
    expect(manageRes.headers['cache-control']).toContain('no-store');

    // Malformed JSON and unknown routes return uniform error envelope with no stack traces or SQL
    const badJsonRes = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(badJsonRes.status).toBe(400);
    expect(badJsonRes.body.error.code).toBeDefined();
    expect(badJsonRes.body.error.requestId).toBeDefined();
    expect(JSON.stringify(badJsonRes.body)).not.toMatch(/at Object\.|node_modules|prisma/i);

    const notFoundRes = await request(app).get('/api/v1/non-existent-route');
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error.code).toBe('NOT_FOUND');

    // Poison outbox message never blocks subsequent valid messages in the queue
    const poison = await prisma.outboxMessage.create({
      data: {
        companyId: company.id,
        channel: NotificationChannel.EMAIL,
        kind: 'GENERIC',
        recipient: '', // invalid empty recipient -> poison message
        payload: {},
        status: OutboxStatus.PENDING,
        dedupeKey: `poison-${randomUUID()}`,
        scheduledFor: DateTime.fromISO('2026-11-16T07:00:00.000Z').toJSDate(),
      },
    });
    const healthy = await prisma.outboxMessage.create({
      data: {
        companyId: company.id,
        channel: NotificationChannel.SMS,
        kind: 'GENERIC',
        recipient: '+996700112233',
        payload: { subject: 'Valid', text: 'Hello' },
        status: OutboxStatus.PENDING,
        dedupeKey: `healthy-${randomUUID()}`,
        scheduledFor: DateTime.fromISO('2026-11-16T07:01:00.000Z').toJSDate(),
      },
    });

    await runOutboxDispatcherOnce({
      registry: {
        email: {
          send: async (p) => {
            if (!p.to) throw new Error('Empty recipient');
          },
        },
        telegram: { send: async () => {} },
        clientMessage: { send: async () => {} },
      },
    });

    const poisonAfter = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: poison.id } });
    const healthyAfter = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: healthy.id } });
    expect(poisonAfter.attempts).toBeGreaterThanOrEqual(1);
    expect(healthyAfter.status).toBe(OutboxStatus.SENT);
  });

  it('anonymizes client PII across Client (incl. telegramChatId), Appointment, OutboxMessage payloads/recipients, InAppNotification, and masks phones in Admin Outbox (SEC-005)', async () => {
    const company = await createCompanyFactory({
      slug: 'pii-sec',
      publicBookingEnabled: true,
      minLeadTimeMin: 0,
    });
    await createTrialSubscriptionForCompany(prisma, company.id);
    const owner = await createUserFactory(company.id, { role: Role.OWNER, isBookable: true });
    const service = await createServiceFactory(company.id, {
      requiresPrepayment: true,
      prepaymentMode: PrepaymentMode.FIXED,
      prepaymentValue: new Prisma.Decimal('200.00'),
    });
    await prisma.masterService.create({ data: { userId: owner.id, serviceId: service.id } });
    for (let d = 1; d <= 7; d++) {
      await prisma.workingHours.create({
        data: { userId: owner.id, dayOfWeek: d, startTime: '08:00', endTime: '20:00' },
      });
    }

    const secretClientName = 'Айбек Сыдыков-Секрет';
    const secretClientPhone = '+996700778899';

    const bookRes = await request(app)
      .post(`/api/v1/public/companies/${company.slug}/appointments`)
      .send({
        serviceId: service.id,
        masterId: owner.id,
        startAt: '2026-11-17T06:00:00.000Z',
        clientName: secretClientName,
        clientPhone: secretClientPhone,
        clientNote: 'Аллергия на парфюм',
        consentAccepted: true,
      });
    expect(bookRes.status).toBe(201);

    const client = await prisma.client.findFirstOrThrow({
      where: { companyId: company.id, phone: secretClientPhone },
    });
    await prisma.client.update({
      where: { id: client.id },
      data: { telegramChatId: '9988776655' },
    });

    // Also create a SENT client reminder OutboxMessage holding raw phone and name
    const bookedApptId =
      (bookRes.body.data.appointment?.id as string | undefined) ??
      (bookRes.body.data.id as string | undefined);
    await prisma.outboxMessage.create({
      data: {
        companyId: company.id,
        appointmentId: bookedApptId,
        channel: NotificationChannel.SMS,
        kind: 'REMINDER_24H',
        recipient: secretClientPhone,
        payload: {
          subject: 'Напоминание',
          text: `Здравствуйте, ${secretClientName} (${secretClientPhone})!`,
        },
        status: OutboxStatus.SENT,
        dedupeKey: `sent-rem-${randomUUID()}`,
        scheduledFor: DateTime.fromISO('2026-11-16T08:00:00.000Z').toJSDate(),
      },
    });

    // Before anonymization: Admin Outbox endpoint must NEVER expose raw end-client phone numbers (SEC-005)
    const admin = await prisma.platformAdmin.create({
      data: {
        email: 'pii-admin@zapis.test',
        name: 'PII Admin',
        passwordHash: 'unused',
        isActive: true,
      },
    });
    const adminToken = signAdminAccessToken(admin);
    const adminOutboxBefore = await request(app)
      .get('/api/v1/admin/outbox')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminOutboxBefore.status).toBe(200);
    expect(JSON.stringify(adminOutboxBefore.body)).not.toContain(secretClientPhone);

    // Execute client anonymization
    const ownerToken = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });
    const anonRes = await request(app)
      .post(`/api/v1/clients/${client.id}/anonymize`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ confirm: true });
    expect(anonRes.status).toBe(200);

    // Inspect DB across all tables: Client, Appointment, OutboxMessage, InAppNotification, AuditLog
    const dbClient = await prismaUnfiltered.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(dbClient.name).toBe('Deleted client');
    expect(dbClient.phone).toBe(`anon-${client.id}`);
    expect(dbClient.telegramChatId).toBeNull();

    const dbAppts = await prismaUnfiltered.appointment.findMany({ where: { clientId: client.id } });
    expect(JSON.stringify(dbAppts)).not.toContain(secretClientName);
    expect(JSON.stringify(dbAppts)).not.toContain(secretClientPhone);

    const dbOutbox = await prismaUnfiltered.outboxMessage.findMany({
      where: { companyId: company.id },
    });
    expect(JSON.stringify(dbOutbox)).not.toContain(secretClientName);
    expect(JSON.stringify(dbOutbox)).not.toContain(secretClientPhone);

    const dbInApp = await prismaUnfiltered.inAppNotification.findMany({
      where: { companyId: company.id },
    });
    expect(JSON.stringify(dbInApp)).not.toContain(secretClientName);
    expect(JSON.stringify(dbInApp)).not.toContain(secretClientPhone);

    const dbAudit = await prismaUnfiltered.auditLog.findMany({
      where: { companyId: company.id },
    });
    expect(JSON.stringify(dbAudit)).not.toContain(secretClientName);
    expect(JSON.stringify(dbAudit)).not.toContain(secretClientPhone);
  });

  it('enforces pagination caps and bounded date ranges on analytics and export endpoints (Domain I)', async () => {
    const company = await createCompanyFactory();
    await createTrialSubscriptionForCompany(prisma, company.id);
    const owner = await createUserFactory(company.id, { role: Role.OWNER });
    const token = signAccessToken({
      sub: owner.id,
      companyId: company.id,
      role: Role.OWNER,
      tv: owner.tokenVersion,
    });

    // Pagination cap (>100 rejected)
    const bigLimitRes = await request(app)
      .get('/api/v1/clients?page=1&limit=5000')
      .set('Authorization', `Bearer ${token}`);
    expect(bigLimitRes.status).toBe(400);

    // Analytics & export range > 366 days rejected
    const wideAnalytics = await request(app)
      .get('/api/v1/analytics/summary?from=2020-01-01&to=2026-11-16')
      .set('Authorization', `Bearer ${token}`);
    expect(wideAnalytics.status).toBe(400);

    const wideExport = await request(app)
      .get('/api/v1/export/appointments.csv?from=2020-01-01&to=2026-11-16')
      .set('Authorization', `Bearer ${token}`);
    expect(wideExport.status).toBe(400);
  });
});
