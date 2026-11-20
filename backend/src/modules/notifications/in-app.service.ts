import type { InAppNotification, Prisma } from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { DbClient } from '../availability/availability.service.js';

export interface InAppNotificationDto {
  id: string;
  companyId: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

function toDto(row: InAppNotification): InAppNotificationDto {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createInAppNotification(
  db: DbClient,
  input: {
    companyId: string;
    userId: string;
    kind: string;
    title: string;
    body: string;
    data?: Record<string, unknown> | null;
  },
): Promise<InAppNotificationDto> {
  const created = await db.inAppNotification.create({
    data: {
      companyId: input.companyId,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      ...(input.data !== undefined && input.data !== null
        ? { data: input.data as Prisma.InputJsonValue }
        : {}),
      createdAt: clockNow(),
    },
  });

  return toDto(created);
}

export async function listNotificationsForUser(
  companyId: string,
  userId: string,
  query: { page: number; limit: number; unreadOnly?: boolean },
): Promise<{ items: InAppNotificationDto[]; total: number }> {
  const where: Prisma.InAppNotificationWhereInput = {
    companyId,
    userId,
    ...(query.unreadOnly ? { readAt: null } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.inAppNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.inAppNotification.count({ where }),
  ]);

  return {
    items: rows.map(toDto),
    total,
  };
}

export async function getUnreadCountForUser(
  companyId: string,
  userId: string,
): Promise<{ unreadCount: number }> {
  const unreadCount = await prisma.inAppNotification.count({
    where: {
      companyId,
      userId,
      readAt: null,
    },
  });

  return { unreadCount };
}

export async function markNotificationRead(
  companyId: string,
  userId: string,
  notificationId: string,
): Promise<InAppNotificationDto> {
  const existing = await prisma.inAppNotification.findFirst({
    where: {
      id: notificationId,
      companyId,
      userId,
    },
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Notification not found');
  }

  if (existing.readAt !== null) {
    return toDto(existing);
  }

  const updated = await prisma.inAppNotification.update({
    where: { id: existing.id },
    data: { readAt: clockNow() },
  });

  return toDto(updated);
}

export async function markAllNotificationsRead(
  companyId: string,
  userId: string,
): Promise<{ updatedCount: number }> {
  const result = await prisma.inAppNotification.updateMany({
    where: {
      companyId,
      userId,
      readAt: null,
    },
    data: {
      readAt: clockNow(),
    },
  });

  return { updatedCount: result.count };
}
