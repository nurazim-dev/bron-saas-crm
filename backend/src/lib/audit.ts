import type { Request } from 'express';
import type { AuditActor, Prisma } from '../generated/prisma/client.js';
import type { DbClient } from '../modules/availability/availability.service.js';
import { maskEmail, maskPhone } from '../modules/notifications/errors.js';
import { now as clockNow } from './clock.js';

const SECRET_KEY_REGEX =
  /password|secret|token|authorization|cookie|totp|recovery|codehash|tokenhash/i;

export interface AuditRequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export function extractAuditContext(req: Request): AuditRequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

function sanitizeAuditValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY_REGEX.test(key)) {
    return '[REDACTED]';
  }
  if (key && typeof value === 'string') {
    if (/email/i.test(key) && value.includes('@')) {
      return maskEmail(value);
    }
    if (/phone/i.test(key)) {
      return maskPhone(value);
    }
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = sanitizeAuditValue(v, k);
      }
    }
    return out;
  }
  return value;
}

export function redactAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) {
    return undefined;
  }
  return sanitizeAuditValue(metadata) as Prisma.InputJsonValue;
}

export interface AuditEntry {
  actorType: AuditActor;
  actorId?: string | null;
  companyId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  context?: AuditRequestContext;
}

export async function audit(db: DbClient, entry: AuditEntry): Promise<void> {
  const sanitized = redactAuditMetadata(entry.metadata);
  await db.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      companyId: entry.companyId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      ...(sanitized !== undefined ? { metadata: sanitized } : {}),
      ip: entry.context?.ip ?? null,
      userAgent: entry.context?.userAgent ? entry.context.userAgent.slice(0, 500) : null,
      createdAt: clockNow(),
    },
  });
}
