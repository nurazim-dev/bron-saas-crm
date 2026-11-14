import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Locale, NotificationChannel, OutboxStatus } from '../../src/generated/prisma/client.js';
import { FakeClock, resetClock, setClock } from '../../src/lib/clock.js';
import { prisma } from '../../src/lib/prisma.js';
import { resetProviderRegistry, setProviderRegistry } from '../../src/lib/registry.js';
import {
  clearOutboxRecheckHook,
  registerOutboxRecheckHook,
  RETRY_BACKOFF_MINUTES,
  runOutboxDispatcherOnce,
} from '../../src/modules/notifications/dispatcher.service.js';
import { ProviderDeliveryError } from '../../src/modules/notifications/errors.js';
import { createInAppNotification } from '../../src/modules/notifications/in-app.service.js';
import { enqueue } from '../../src/modules/notifications/outbox.service.js';
import type {
  ClientMessageProvider,
  EmailProvider,
  EmailSendParams,
  TelegramProvider,
  TelegramSendParams,
} from '../../src/modules/notifications/providers/types.js';
import { truncateAllTables } from '../helpers/db.js';

class FakeEmailProvider implements EmailProvider {
  readonly sent: EmailSendParams[] = [];
  nextError: Error | null = null;

  send(params: EmailSendParams): Promise<void> {
    if (this.nextError) {
      return Promise.reject(this.nextError);
    }
    this.sent.push(params);
    return Promise.resolve();
  }
}

class FakeTelegramProvider implements TelegramProvider {
  readonly sent: TelegramSendParams[] = [];
  nextError: Error | null = null;

  send(params: TelegramSendParams): Promise<void> {
    if (this.nextError) {
      return Promise.reject(this.nextError);
    }
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

describe('Notification infrastructure (Phase 12)', () => {
  const app = createApp();
  let fakeEmail: FakeEmailProvider;
  let fakeTelegram: FakeTelegramProvider;
  let fakeClient: FakeClientMessageProvider;

  beforeEach(async () => {
    await truncateAllTables();
    fakeEmail = new FakeEmailProvider();
    fakeTelegram = new FakeTelegramProvider();
    fakeClient = new FakeClientMessageProvider();
    setProviderRegistry({
      email: fakeEmail,
      telegram: fakeTelegram,
      clientMessage: fakeClient,
    });
  });

  afterEach(() => {
    resetClock();
    resetProviderRegistry();
    clearOutboxRecheckHook('SYSTEM_TEST');
  });

  describe('Outbox enqueue & transactionality', () => {
    it('is idempotent on dedupeKey and rolls back when outer transaction fails', async () => {
      const first = await enqueue(prisma, {
        channel: NotificationChannel.EMAIL,
        kind: 'SYSTEM_TEST',
        recipient: 'client@example.com',
        locale: Locale.RU,
        payload: { label: 'first' },
        dedupeKey: 'test:dedupe:1',
      });
      expect(first.enqueued).toBe(true);
      expect(first.id).toBeTruthy();

      const second = await enqueue(prisma, {
        channel: NotificationChannel.EMAIL,
        kind: 'SYSTEM_TEST',
        recipient: 'client@example.com',
        locale: Locale.RU,
        payload: { label: 'duplicate' },
        dedupeKey: 'test:dedupe:1',
      });
      expect(second.enqueued).toBe(false);
      expect(second.id).toBeNull();

      await expect(
        prisma.$transaction(async (tx) => {
          await enqueue(tx, {
            channel: NotificationChannel.EMAIL,
            kind: 'SYSTEM_TEST',
            recipient: 'rollback@example.com',
            locale: Locale.RU,
            payload: { label: 'should-rollback' },
            dedupeKey: 'test:rollback:1',
          });
          throw new Error('force rollback');
        }),
      ).rejects.toThrow('force rollback');

      const rolledBack = await prisma.outboxMessage.findUnique({
        where: { dedupeKey: 'test:rollback:1' },
      });
      expect(rolledBack).toBeNull();
    });
  });

  describe('Outbox dispatcher & backoff', () => {
    it('delivers EMAIL and TELEGRAM messages and marks them SENT', async () => {
      const clock = new FakeClock(new Date('2026-11-14T10:00:00.000Z'));
      setClock(clock);

      await enqueue(prisma, {
        channel: NotificationChannel.EMAIL,
        kind: 'SYSTEM_TEST',
        recipient: 'owner@example.com',
        locale: Locale.RU,
        payload: { label: 'email-check' },
        dedupeKey: 'dispatch:email:1',
      });
      await enqueue(prisma, {
        channel: NotificationChannel.TELEGRAM,
        kind: 'SYSTEM_TEST',
        recipient: '123456789',
        locale: Locale.KY,
        payload: { message: 'tg-<script>alert(1)</script>' },
        dedupeKey: 'dispatch:tg:1',
      });

      const summary = await runOutboxDispatcherOnce();
      expect(summary).toEqual({ claimed: 2, sent: 2, skipped: 0, retried: 0, failed: 0 });
      expect(fakeEmail.sent).toHaveLength(1);
      expect(fakeTelegram.sent).toHaveLength(1);
      expect(fakeTelegram.sent[0]?.html).toContain('&lt;script&gt;');

      const rows = await prisma.outboxMessage.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows.every((r) => r.status === OutboxStatus.SENT)).toBe(true);
      expect(rows.every((r) => r.sentAt !== null)).toBe(true);
    });

    it('retries transient errors using backoff 1m, 5m, 30m, 2h, 12h and fails at maxAttempts', async () => {
      const clock = new FakeClock(new Date('2026-11-14T10:00:00.000Z'));
      setClock(clock);

      const res = await enqueue(prisma, {
        channel: NotificationChannel.EMAIL,
        kind: 'SYSTEM_TEST',
        recipient: 'retry@example.com',
        payload: { label: 'retry' },
        dedupeKey: 'dispatch:retry:1',
        maxAttempts: 5,
      });
      const msgId = res.id ?? '';
      expect(msgId).not.toBe('');

      fakeEmail.nextError = new ProviderDeliveryError(
        'SMTP temporary 421 Bearer secret-token',
        false,
      );

      for (let attempt = 1; attempt <= 4; attempt++) {
        const summary = await runOutboxDispatcherOnce();
        expect(summary).toEqual({ claimed: 1, sent: 0, skipped: 0, retried: 1, failed: 0 });

        const msg = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: msgId } });
        expect(msg.status).toBe(OutboxStatus.PENDING);
        expect(msg.attempts).toBe(attempt);
        expect(msg.lastError).not.toContain('secret-token');

        const delayMinutes = RETRY_BACKOFF_MINUTES[attempt - 1] ?? 0;
        const expectedDelayMs = delayMinutes * 60_000;
        expect(msg.scheduledFor.getTime()).toBe(clock.now().getTime() + expectedDelayMs);

        clock.advanceMs(expectedDelayMs);
      }

      const finalSummary = await runOutboxDispatcherOnce();
      expect(finalSummary).toEqual({ claimed: 1, sent: 0, skipped: 0, retried: 0, failed: 1 });

      const failedMsg = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: msgId } });
      expect(failedMsg.status).toBe(OutboxStatus.FAILED);
      expect(failedMsg.attempts).toBe(5);
    });

    it('marks permanent provider errors as FAILED immediately without retry', async () => {
      const clock = new FakeClock(new Date('2026-11-14T10:00:00.000Z'));
      setClock(clock);

      const res = await enqueue(prisma, {
        channel: NotificationChannel.EMAIL,
        kind: 'SYSTEM_TEST',
        recipient: 'bad@example.com',
        payload: { label: 'perm' },
        dedupeKey: 'dispatch:perm:1',
        maxAttempts: 5,
      });
      const msgId = res.id ?? '';
      expect(msgId).not.toBe('');

      fakeEmail.nextError = new ProviderDeliveryError(
        'Invalid recipient mailbox',
        true,
        'EENVELOPE',
      );

      const summary = await runOutboxDispatcherOnce();
      expect(summary).toEqual({ claimed: 1, sent: 0, skipped: 0, retried: 0, failed: 1 });

      const msg = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: msgId } });
      expect(msg.status).toBe(OutboxStatus.FAILED);
      expect(msg.attempts).toBe(1);
    });

    it('marks message SKIPPED when recheck hook returns skip=true', async () => {
      const clock = new FakeClock(new Date('2026-11-14T10:00:00.000Z'));
      setClock(clock);

      registerOutboxRecheckHook('SYSTEM_TEST', () =>
        Promise.resolve({
          skip: true,
          reason: 'appointment cancelled',
        }),
      );

      const res = await enqueue(prisma, {
        channel: NotificationChannel.EMAIL,
        kind: 'SYSTEM_TEST',
        recipient: 'skip@example.com',
        payload: { label: 'skip' },
        dedupeKey: 'dispatch:skip:1',
      });
      const msgId = res.id ?? '';
      expect(msgId).not.toBe('');

      const summary = await runOutboxDispatcherOnce();
      expect(summary).toEqual({ claimed: 1, sent: 0, skipped: 1, retried: 0, failed: 0 });
      expect(fakeEmail.sent).toHaveLength(0);

      const msg = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: msgId } });
      expect(msg.status).toBe(OutboxStatus.SKIPPED);
      expect(msg.lastError).toBe('appointment cancelled');
    });

    it('delivers each due message exactly once when two dispatchers run in parallel (SKIP LOCKED)', async () => {
      const clock = new FakeClock(new Date('2026-11-14T10:00:00.000Z'));
      setClock(clock);

      for (let i = 0; i < 6; i++) {
        await enqueue(prisma, {
          channel: NotificationChannel.EMAIL,
          kind: 'SYSTEM_TEST',
          recipient: `user${i}@example.com`,
          payload: { index: i },
          dedupeKey: `dispatch:parallel:${i}`,
        });
      }

      const [s1, s2] = await Promise.all([
        runOutboxDispatcherOnce({ batchSize: 10 }),
        runOutboxDispatcherOnce({ batchSize: 10 }),
      ]);

      expect(s1.sent + s2.sent).toBe(6);
      expect(fakeEmail.sent).toHaveLength(6);
    });
  });

  describe('Real SMTP smoke test via Mailpit', () => {
    it('sends a real email to Mailpit and verifies receipt via Mailpit API', async () => {
      resetProviderRegistry();

      const uniqueTag = `mailpit-smoke-${Date.now()}`;
      await enqueue(prisma, {
        channel: NotificationChannel.EMAIL,
        kind: 'SYSTEM_TEST',
        recipient: 'smoke@zapis.test',
        locale: Locale.RU,
        payload: { tag: uniqueTag },
        dedupeKey: `smoke:${uniqueTag}`,
      });

      const summary = await runOutboxDispatcherOnce();
      expect(summary.sent).toBe(1);

      const mailpitRes = await fetch('http://localhost:8025/api/v1/messages?limit=10');
      expect(mailpitRes.status).toBe(200);
      const body = (await mailpitRes.json()) as {
        messages?: Array<{ ID: string; To?: Array<{ Address: string }>; Subject?: string }>;
      };
      const found = body.messages?.find((m) =>
        m.To?.some((addr) => addr.Address === 'smoke@zapis.test'),
      );
      expect(found).toBeDefined();

      // Clean up Mailpit inbox after verification
      await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
    });
  });

  describe('In-app notifications API & tenant isolation', () => {
    it('lists, counts unread, marks one read, marks all read, and enforces tenant/user isolation', async () => {
      const regA = await request(app).post('/api/v1/auth/register').send({
        ownerName: 'Owner A',
        email: 'owner-a@example.com',
        password: 'Password123',
        companyName: 'Salon A',
        businessType: 'BARBERSHOP',
      });
      expect(regA.status).toBe(201);
      const ownerA = (
        regA.body as {
          data: {
            accessToken: string;
            user: { id: string };
            company: { id: string };
          };
        }
      ).data;

      const regB = await request(app).post('/api/v1/auth/register').send({
        ownerName: 'Owner B',
        email: 'owner-b@example.com',
        password: 'Password123',
        companyName: 'Salon B',
        businessType: 'BEAUTY_SALON',
      });
      expect(regB.status).toBe(201);
      const ownerB = (
        regB.body as {
          data: {
            accessToken: string;
            user: { id: string };
            company: { id: string };
          };
        }
      ).data;

      const n1 = await createInAppNotification(prisma, {
        companyId: ownerA.company.id,
        userId: ownerA.user.id,
        kind: 'SYSTEM_TEST',
        title: 'First alert',
        body: 'Body 1',
      });
      const n2 = await createInAppNotification(prisma, {
        companyId: ownerA.company.id,
        userId: ownerA.user.id,
        kind: 'SYSTEM_TEST',
        title: 'Second alert',
        body: 'Body 2',
      });
      const nOther = await createInAppNotification(prisma, {
        companyId: ownerB.company.id,
        userId: ownerB.user.id,
        kind: 'SYSTEM_TEST',
        title: 'Tenant B alert',
        body: 'Secret',
      });

      const listRes = await request(app)
        .get('/api/v1/notifications?page=1&limit=10')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(listRes.status).toBe(200);
      const listBody = listRes.body as {
        data: Array<{ id: string }>;
        meta: { total: number };
      };
      expect(listBody.data).toHaveLength(2);
      expect(listBody.meta.total).toBe(2);

      const countRes1 = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(countRes1.status).toBe(200);
      expect((countRes1.body as { data: { unreadCount: number } }).data).toEqual({
        unreadCount: 2,
      });

      // Cross-tenant read attempt returns 404 NOT_FOUND
      const crossTenantRes = await request(app)
        .post(`/api/v1/notifications/${nOther.id}/read`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(crossTenantRes.status).toBe(404);
      expect((crossTenantRes.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');

      // Mark one read
      const readOneRes = await request(app)
        .post(`/api/v1/notifications/${n1.id}/read`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(readOneRes.status).toBe(200);
      expect((readOneRes.body as { data: { readAt: string | null } }).data.readAt).toBeTruthy();

      const unreadOnlyRes = await request(app)
        .get('/api/v1/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(unreadOnlyRes.status).toBe(200);
      const unreadBody = unreadOnlyRes.body as { data: Array<{ id: string }> };
      expect(unreadBody.data).toHaveLength(1);
      expect(unreadBody.data[0]?.id).toBe(n2.id);

      // Mark all read
      const readAllRes = await request(app)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(readAllRes.status).toBe(200);
      expect((readAllRes.body as { data: { updatedCount: number } }).data.updatedCount).toBe(1);

      const countRes2 = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect((countRes2.body as { data: { unreadCount: number } }).data).toEqual({
        unreadCount: 0,
      });
    });
  });
});
