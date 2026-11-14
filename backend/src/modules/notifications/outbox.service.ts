import { randomUUID } from 'node:crypto';
import { Locale, type NotificationChannel, Prisma } from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import type { DbClient } from '../availability/availability.service.js';

export interface EnqueueOutboxSpec {
  companyId?: string | null;
  channel: NotificationChannel;
  kind: string;
  recipient: string;
  toUserId?: string | null;
  appointmentId?: string | null;
  locale?: Locale;
  payload: Record<string, unknown>;
  dedupeKey: string;
  scheduledFor?: Date;
  maxAttempts?: number;
}

export interface EnqueueOutboxResult {
  id: string | null;
  enqueued: boolean;
}

export async function enqueue(db: DbClient, spec: EnqueueOutboxSpec): Promise<EnqueueOutboxResult> {
  const id = randomUUID();
  const currentNow = clockNow();
  const scheduledFor = spec.scheduledFor ?? currentNow;
  const locale = spec.locale ?? Locale.RU;
  const maxAttempts = spec.maxAttempts ?? 5;
  const payloadJson = JSON.stringify(spec.payload);

  const inserted = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "OutboxMessage" (
      "id",
      "companyId",
      "channel",
      "kind",
      "recipient",
      "toUserId",
      "appointmentId",
      "locale",
      "payload",
      "dedupeKey",
      "status",
      "attempts",
      "maxAttempts",
      "scheduledFor",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${id}::uuid,
      ${spec.companyId ?? null}::uuid,
      ${spec.channel}::"NotificationChannel",
      ${spec.kind},
      ${spec.recipient},
      ${spec.toUserId ?? null}::uuid,
      ${spec.appointmentId ?? null}::uuid,
      ${locale}::"Locale",
      ${payloadJson}::jsonb,
      ${spec.dedupeKey},
      'PENDING'::"OutboxStatus",
      0,
      ${maxAttempts},
      ${scheduledFor},
      ${currentNow},
      ${currentNow}
    )
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING "id"
  `);

  const createdRow = inserted[0];
  if (!createdRow) {
    return { id: null, enqueued: false };
  }

  return { id: createdRow.id, enqueued: true };
}
