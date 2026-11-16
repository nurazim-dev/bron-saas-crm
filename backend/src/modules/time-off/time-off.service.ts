import { AppointmentStatus, Role, type TimeOff } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { localAllDayRangeToUtc, parseNormalizedStartAtUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import { lockMastersForUpdate } from '../appointments/appointments.service.js';
import type { CreateTimeOffBody, ListTimeOffQuery, UpdateTimeOffBody } from './time-off.schemas.js';

export interface TimeOffDto {
  id: string;
  companyId: string;
  userId: string;
  userName?: string;
  startAt: string;
  endAt: string;
  kind: TimeOff['kind'];
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeOffConflictsDto {
  count: number;
  appointmentIds: string[];
}

function serializeTimeOff(row: TimeOff & { user?: { name: string } }): TimeOffDto {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    ...(row.user ? { userName: row.user.name } : {}),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    kind: row.kind,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function resolveRangeUtc(
  input: {
    allDay?: boolean;
    startDate?: string;
    endDate?: string;
    startAt?: string;
    endAt?: string;
  },
  timezone: string,
): { startAt: Date; endAt: Date } {
  if (input.allDay) {
    if (!input.startDate || !input.endDate) {
      throw new AppError('VALIDATION_ERROR', 400, 'startDate and endDate are required for allDay');
    }
    return localAllDayRangeToUtc(input.startDate, input.endDate, timezone);
  }
  if (!input.startAt || !input.endAt) {
    throw new AppError('VALIDATION_ERROR', 400, 'startAt and endAt are required');
  }
  const startAt = parseNormalizedStartAtUtc(input.startAt);
  const endAt = parseNormalizedStartAtUtc(input.endAt);
  if (endAt <= startAt) {
    throw new AppError('VALIDATION_ERROR', 400, 'endAt must be strictly after startAt');
  }
  return { startAt, endAt };
}

export async function listTimeOffForActor(
  actor: AuthenticatedActor,
  query: ListTimeOffQuery,
): Promise<TimeOffDto[]> {
  if (actor.role === Role.MASTER && query.userId && query.userId !== actor.userId) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  const targetUserId = actor.role === Role.MASTER ? actor.userId : query.userId;

  const rows = await prisma.timeOff.findMany({
    where: {
      companyId: actor.companyId,
      ...(targetUserId ? { userId: targetUserId } : {}),
      ...(query.from ? { endAt: { gt: parseNormalizedStartAtUtc(query.from) } } : {}),
      ...(query.to ? { startAt: { lt: parseNormalizedStartAtUtc(query.to) } } : {}),
    },
    include: {
      user: { select: { name: true } },
    },
    orderBy: { startAt: 'asc' },
  });

  return rows.map(serializeTimeOff);
}

export async function createTimeOffForActor(
  actor: AuthenticatedActor,
  input: CreateTimeOffBody,
  auditCtx?: AuditRequestContext,
): Promise<{ timeOff: TimeOffDto; conflicts: TimeOffConflictsDto }> {
  const targetUserId = input.userId ?? actor.userId;
  if (actor.role === Role.MASTER && targetUserId !== actor.userId) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  const [company, targetUser] = await Promise.all([
    prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { timezone: true },
    }),
    prisma.user.findFirst({
      where: { id: targetUserId, companyId: actor.companyId },
      select: { id: true, name: true },
    }),
  ]);

  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }
  if (!targetUser) {
    throw new AppError('NOT_FOUND', 404, 'Staff member not found');
  }

  const { startAt, endAt } = resolveRangeUtc(input, company.timezone);

  return prisma.$transaction(async (tx) => {
    await lockMastersForUpdate(tx, [targetUser.id]);

    const created = await tx.timeOff.create({
      data: {
        companyId: actor.companyId,
        userId: targetUser.id,
        startAt,
        endAt,
        kind: input.kind,
        note: input.note ?? null,
      },
      include: {
        user: { select: { name: true } },
      },
    });

    const conflictingAppointments = await tx.appointment.findMany({
      where: {
        companyId: actor.companyId,
        masterId: targetUser.id,
        deletedAt: null,
        status: AppointmentStatus.SCHEDULED,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
      orderBy: { startAt: 'asc' },
    });

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'time_off.create',
      entityType: 'TimeOff',
      entityId: created.id,
      metadata: {
        userId: targetUser.id,
        kind: created.kind,
        conflictCount: conflictingAppointments.length,
      },
      ...auditCtx,
    });

    return {
      timeOff: serializeTimeOff(created),
      conflicts: {
        count: conflictingAppointments.length,
        appointmentIds: conflictingAppointments.map((a) => a.id),
      },
    };
  });
}

export async function updateTimeOffForActor(
  actor: AuthenticatedActor,
  id: string,
  input: UpdateTimeOffBody,
  auditCtx?: AuditRequestContext,
): Promise<{ timeOff: TimeOffDto; conflicts: TimeOffConflictsDto }> {
  const [existing, company] = await Promise.all([
    prisma.timeOff.findFirst({
      where: { id, companyId: actor.companyId },
    }),
    prisma.company.findUnique({
      where: { id: actor.companyId },
      select: { timezone: true },
    }),
  ]);

  if (!existing || !company) {
    throw new AppError('NOT_FOUND', 404, 'Time off record not found');
  }
  if (actor.role === Role.MASTER && existing.userId !== actor.userId) {
    throw new AppError('NOT_FOUND', 404, 'Time off record not found');
  }

  let nextStartAt = existing.startAt;
  let nextEndAt = existing.endAt;

  if (
    input.allDay !== undefined ||
    input.startDate !== undefined ||
    input.endDate !== undefined ||
    input.startAt !== undefined ||
    input.endAt !== undefined
  ) {
    const resolved = resolveRangeUtc(
      {
        allDay: input.allDay,
        startDate: input.startDate,
        endDate: input.endDate,
        startAt: input.startAt ?? existing.startAt.toISOString(),
        endAt: input.endAt ?? existing.endAt.toISOString(),
      },
      company.timezone,
    );
    nextStartAt = resolved.startAt;
    nextEndAt = resolved.endAt;
  }

  return prisma.$transaction(async (tx) => {
    await lockMastersForUpdate(tx, [existing.userId]);

    const updated = await tx.timeOff.update({
      where: { id: existing.id },
      data: {
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        startAt: nextStartAt,
        endAt: nextEndAt,
      },
      include: {
        user: { select: { name: true } },
      },
    });

    const conflictingAppointments = await tx.appointment.findMany({
      where: {
        companyId: actor.companyId,
        masterId: existing.userId,
        deletedAt: null,
        status: AppointmentStatus.SCHEDULED,
        startAt: { lt: nextEndAt },
        endAt: { gt: nextStartAt },
      },
      select: { id: true },
      orderBy: { startAt: 'asc' },
    });

    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'time_off.update',
      entityType: 'TimeOff',
      entityId: updated.id,
      metadata: {
        conflictCount: conflictingAppointments.length,
      },
      ...auditCtx,
    });

    return {
      timeOff: serializeTimeOff(updated),
      conflicts: {
        count: conflictingAppointments.length,
        appointmentIds: conflictingAppointments.map((a) => a.id),
      },
    };
  });
}

export async function deleteTimeOffForActor(
  actor: AuthenticatedActor,
  id: string,
  auditCtx?: AuditRequestContext,
): Promise<void> {
  const existing = await prisma.timeOff.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Time off record not found');
  }
  if (actor.role === Role.MASTER && existing.userId !== actor.userId) {
    throw new AppError('NOT_FOUND', 404, 'Time off record not found');
  }

  await prisma.$transaction(async (tx) => {
    await lockMastersForUpdate(tx, [existing.userId]);
    await tx.timeOff.delete({ where: { id: existing.id } });
    await audit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      companyId: actor.companyId,
      action: 'time_off.delete',
      entityType: 'TimeOff',
      entityId: existing.id,
      ...auditCtx,
    });
  });
}
