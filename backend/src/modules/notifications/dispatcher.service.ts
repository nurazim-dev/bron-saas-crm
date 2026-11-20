import {
  type Locale,
  NotificationChannel,
  OutboxStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { addMinutesUtc } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getProviderRegistry, type ProviderRegistry } from '../../lib/registry.js';
import type { DbClient } from '../availability/availability.service.js';
import { classifyProviderError, maskEmail, maskPhone } from './errors.js';
import { renderNotificationTemplate } from './templates/index.js';

export const RETRY_BACKOFF_MINUTES = [1, 5, 30, 120, 720] as const;
const DEFAULT_BATCH_SIZE = 20;

export interface ClaimedOutboxMessage {
  id: string;
  companyId: string | null;
  channel: NotificationChannel;
  kind: string;
  recipient: string;
  toUserId: string | null;
  appointmentId: string | null;
  locale: Locale;
  payload: unknown;
  dedupeKey: string;
  attempts: number;
  maxAttempts: number;
  scheduledFor: Date;
}

export type OutboxRecheckResult = { skip: false } | { skip: true; reason: string };

export type OutboxRecheckHook = (
  db: DbClient,
  message: ClaimedOutboxMessage,
  currentNow: Date,
) => Promise<OutboxRecheckResult>;

const recheckHooks = new Map<string, OutboxRecheckHook>();

export function registerOutboxRecheckHook(kind: string, hook: OutboxRecheckHook): void {
  recheckHooks.set(kind, hook);
}

export function clearOutboxRecheckHook(kind: string): void {
  recheckHooks.delete(kind);
}

export interface DispatcherRunSummary {
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
}

export interface DispatcherDeps {
  db?: typeof prisma;
  registry?: ProviderRegistry;
  batchSize?: number;
}

function maskRecipientForLog(channel: NotificationChannel, recipient: string): string {
  if (channel === NotificationChannel.EMAIL) {
    return maskEmail(recipient);
  }
  if (channel === NotificationChannel.SMS || channel === NotificationChannel.WHATSAPP) {
    return maskPhone(recipient);
  }
  return `tg:***${recipient.slice(-4)}`;
}

async function claimDueMessages(
  db: typeof prisma,
  currentNow: Date,
  batchSize: number,
): Promise<ClaimedOutboxMessage[]> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.$queryRaw<ClaimedOutboxMessage[]>(Prisma.sql`
      WITH due AS (
        SELECT "id"
        FROM "OutboxMessage"
        WHERE "status" = 'PENDING'::"OutboxStatus"
          AND "scheduledFor" <= ${currentNow}
        ORDER BY "scheduledFor" ASC, "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "OutboxMessage" AS m
      SET
        "status" = 'PROCESSING'::"OutboxStatus",
        "lockedAt" = ${currentNow},
        "updatedAt" = ${currentNow}
      FROM due
      WHERE m."id" = due."id"
      RETURNING
        m."id",
        m."companyId",
        m."channel",
        m."kind",
        m."recipient",
        m."toUserId",
        m."appointmentId",
        m."locale",
        m."payload",
        m."dedupeKey",
        m."attempts",
        m."maxAttempts",
        m."scheduledFor"
    `);

    return claimed;
  });
}

async function deliverMessage(
  msg: ClaimedOutboxMessage,
  registry: ProviderRegistry,
): Promise<void> {
  const payloadObj =
    typeof msg.payload === 'object' && msg.payload !== null && !Array.isArray(msg.payload)
      ? (msg.payload as Record<string, unknown>)
      : {};

  const rendered = renderNotificationTemplate(msg.kind, msg.locale, payloadObj);

  switch (msg.channel) {
    case NotificationChannel.EMAIL:
      await registry.email.send({
        to: msg.recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      return;
    case NotificationChannel.TELEGRAM: {
      const replyMarkup =
        typeof payloadObj.replyMarkup === 'object' &&
        payloadObj.replyMarkup !== null &&
        !Array.isArray(payloadObj.replyMarkup)
          ? (payloadObj.replyMarkup as {
              inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
            })
          : undefined;
      const customTelegramHtml =
        typeof payloadObj.telegramHtml === 'string' && payloadObj.telegramHtml.trim().length > 0
          ? payloadObj.telegramHtml
          : rendered.telegramHtml;
      await registry.telegram.send({
        chatId: msg.recipient,
        html: customTelegramHtml,
        replyMarkup,
      });
      return;
    }
    case NotificationChannel.SMS:
      await registry.clientMessage.send({
        channel: 'SMS',
        to: msg.recipient,
        text: rendered.text,
      });
      return;
    case NotificationChannel.WHATSAPP:
      await registry.clientMessage.send({
        channel: 'WHATSAPP',
        to: msg.recipient,
        text: rendered.text,
      });
      return;
  }
}

export async function runOutboxDispatcherOnce(
  deps: DispatcherDeps = {},
  currentNow: Date = clockNow(),
): Promise<DispatcherRunSummary> {
  const db = deps.db ?? prisma;
  const registry = deps.registry ?? getProviderRegistry();
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  const summary: DispatcherRunSummary = {
    claimed: 0,
    sent: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
  };

  const claimed = await claimDueMessages(db, currentNow, batchSize);
  summary.claimed = claimed.length;

  for (const msg of claimed) {
    const hook = recheckHooks.get(msg.kind);
    if (hook) {
      const recheck = await hook(db, msg, currentNow);
      if (recheck.skip) {
        await db.outboxMessage.update({
          where: { id: msg.id },
          data: {
            status: OutboxStatus.SKIPPED,
            lockedAt: null,
            lastError: recheck.reason,
            updatedAt: currentNow,
          },
        });
        summary.skipped += 1;
        continue;
      }
    }

    try {
      await deliverMessage(msg, registry);
      await db.outboxMessage.update({
        where: { id: msg.id },
        data: {
          status: OutboxStatus.SENT,
          attempts: msg.attempts + 1,
          sentAt: currentNow,
          lockedAt: null,
          lastError: null,
          updatedAt: currentNow,
        },
      });
      summary.sent += 1;
    } catch (err) {
      const { isPermanent, sanitizedMessage } = classifyProviderError(err);
      const nextAttempts = msg.attempts + 1;
      const exhausted = isPermanent || nextAttempts >= msg.maxAttempts;

      if (exhausted) {
        await db.outboxMessage.update({
          where: { id: msg.id },
          data: {
            status: OutboxStatus.FAILED,
            attempts: nextAttempts,
            lockedAt: null,
            lastError: sanitizedMessage,
            updatedAt: currentNow,
          },
        });
        summary.failed += 1;
      } else {
        const backoffIdx = Math.min(nextAttempts - 1, RETRY_BACKOFF_MINUTES.length - 1);
        const backoffMinutes = RETRY_BACKOFF_MINUTES[backoffIdx] ?? 720;
        const nextScheduledFor = addMinutesUtc(currentNow, backoffMinutes);

        await db.outboxMessage.update({
          where: { id: msg.id },
          data: {
            status: OutboxStatus.PENDING,
            attempts: nextAttempts,
            scheduledFor: nextScheduledFor,
            lockedAt: null,
            lastError: sanitizedMessage,
            updatedAt: currentNow,
          },
        });
        summary.retried += 1;
      }

      logger.warn(
        {
          outboxId: msg.id,
          kind: msg.kind,
          channel: msg.channel,
          recipient: maskRecipientForLog(msg.channel, msg.recipient),
          attempts: nextAttempts,
          isPermanent,
          exhausted,
        },
        'Outbox delivery failed',
      );
    }
  }

  return summary;
}
