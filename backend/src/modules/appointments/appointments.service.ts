import {
  AppointmentSource,
  AppointmentStatus,
  Prisma,
  Role,
  type Appointment,
} from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { addDurationMsUtc, addMinutesUtc } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isExclusionConstraintError } from '../../middleware/error-handler.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type {
  CreateAppointmentBody,
  ListAppointmentsQuery,
  UpdateAppointmentBody,
  UpdateAppointmentStatusBody,
} from './appointments.schemas.js';

export type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface AppointmentServiceSummaryDto {
  id: string;
  name: string;
  durationMin: number;
}

export interface AppointmentMasterSummaryDto {
  id: string;
  name: string;
}

export interface AppointmentDto {
  id: string;
  companyId: string;
  masterId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  clientNote: string | null;
  internalNote: string | null;
  startAt: string;
  endAt: string;
  price: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  service: AppointmentServiceSummaryDto;
  master: AppointmentMasterSummaryDto;
  createdAt: string;
  updatedAt: string;
}

type AppointmentWithRelations = Appointment & {
  service: { id: string; name: string; durationMin: number };
  master: { id: string; name: string };
};

export const appointmentInclude = {
  service: {
    select: {
      id: true,
      name: true,
      durationMin: true,
    },
  },
  master: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

export function serializeAppointment(appt: AppointmentWithRelations): AppointmentDto {
  return {
    id: appt.id,
    companyId: appt.companyId,
    masterId: appt.masterId,
    serviceId: appt.serviceId,
    clientName: appt.clientName,
    clientPhone: appt.clientPhone,
    clientNote: appt.clientNote,
    internalNote: appt.internalNote,
    startAt: appt.startAt.toISOString(),
    endAt: appt.endAt.toISOString(),
    price: appt.price.toFixed(2),
    status: appt.status,
    source: appt.source,
    service: {
      id: appt.service.id,
      name: appt.service.name,
      durationMin: appt.service.durationMin,
    },
    master: {
      id: appt.master.id,
      name: appt.master.name,
    },
    createdAt: appt.createdAt.toISOString(),
    updatedAt: appt.updatedAt.toISOString(),
  };
}

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.COMPLETED,
];

/**
 * Acquires a row-level `FOR UPDATE` lock on the master(s) inside an open transaction (BR-1).
 * Locks multiple IDs in deterministic sorted order to prevent deadlocks.
 */
export async function lockMastersForUpdate(
  tx: TransactionClient,
  masterIds: string[],
): Promise<void> {
  const uniqueSorted = [...new Set(masterIds)].sort();
  for (const masterId of uniqueSorted) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${masterId}::uuid FOR UPDATE`;
  }
}

/**
 * Checks for any non-deleted SCHEDULED/COMPLETED appointment overlapping `[startAt, endAt)`
 * for `(companyId, masterId)` inside a transaction after locking the master row (BR-1).
 */
export async function assertNoSlotOverlap(
  tx: TransactionClient,
  params: {
    companyId: string;
    masterId: string;
    startAt: Date;
    endAt: Date;
    excludeAppointmentId?: string;
  },
): Promise<void> {
  const conflict = await tx.appointment.findFirst({
    where: {
      companyId: params.companyId,
      masterId: params.masterId,
      deletedAt: null,
      status: { in: BLOCKING_STATUSES },
      startAt: { lt: params.endAt },
      endAt: { gt: params.startAt },
      ...(params.excludeAppointmentId !== undefined
        ? { id: { not: params.excludeAppointmentId } }
        : {}),
    },
    select: { id: true },
  });

  if (conflict) {
    throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Selected time slot is already booked');
  }
}

function normalizeOptionalNote(note: string | null | undefined): string | null | undefined {
  if (note === undefined) return undefined;
  if (note === null || note.length === 0) return null;
  return note;
}

async function validateBookableMasterAndService(
  companyId: string,
  masterId: string,
  serviceId: string,
) {
  const [master, service] = await Promise.all([
    prisma.user.findFirst({
      where: { id: masterId, companyId },
    }),
    prisma.service.findFirst({
      where: { id: serviceId, companyId },
    }),
  ]);

  if (!master) {
    throw new AppError('NOT_FOUND', 404, 'Master not found');
  }
  if (!service) {
    throw new AppError('NOT_FOUND', 404, 'Service not found');
  }

  if (!master.isActive || !master.isBookable) {
    throw new AppError('VALIDATION_ERROR', 400, 'Selected master is not active or not bookable', [
      { path: 'masterId', message: 'Selected master is not active or not bookable' },
    ]);
  }

  if (!service.isActive) {
    throw new AppError('VALIDATION_ERROR', 400, 'Selected service is not active', [
      { path: 'serviceId', message: 'Selected service is not active' },
    ]);
  }

  const link = await prisma.masterService.findUnique({
    where: {
      userId_serviceId: {
        userId: master.id,
        serviceId: service.id,
      },
    },
  });

  if (!link) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Selected master does not provide the selected service',
      [{ path: 'serviceId', message: 'Selected master does not provide the selected service' }],
    );
  }

  return { master, service };
}

export interface PaginatedAppointmentsResult {
  data: AppointmentDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

export async function listAppointmentsForActor(
  actor: AuthenticatedActor,
  query: ListAppointmentsQuery,
): Promise<PaginatedAppointmentsResult> {
  // BR-5: A MASTER's list queries are forced to his own masterId.
  const effectiveMasterId = actor.role === Role.MASTER ? actor.userId : query.masterId;

  const where: Prisma.AppointmentWhereInput = {
    companyId: actor.companyId,
    startAt: { lt: query.to },
    endAt: { gt: query.from },
    ...(effectiveMasterId !== undefined ? { masterId: effectiveMasterId } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
      skip,
      take: query.limit,
    }),
    prisma.appointment.count({ where }),
  ]);

  return {
    data: rows.map(serializeAppointment),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
    },
  };
}

export async function getAppointmentByIdForActor(
  actor: AuthenticatedActor,
  appointmentId: string,
): Promise<AppointmentDto> {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      companyId: actor.companyId,
      ...(actor.role === Role.MASTER ? { masterId: actor.userId } : {}),
    },
    include: appointmentInclude,
  });

  if (!appointment) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  return serializeAppointment(appointment);
}

export async function createStaffAppointmentForActor(
  actor: AuthenticatedActor,
  input: CreateAppointmentBody,
): Promise<AppointmentDto> {
  // BR-5: MASTER may create appointments only for self; object/other-master probing returns 404/403
  if (actor.role === Role.MASTER && input.masterId !== actor.userId) {
    throw new AppError('FORBIDDEN', 403, 'Masters can only create appointments for themselves');
  }

  const { master, service } = await validateBookableMasterAndService(
    actor.companyId,
    input.masterId,
    input.serviceId,
  );

  const startAt = input.startAt;
  const endAt = addMinutesUtc(startAt, service.durationMin);
  const price = input.price !== undefined ? new Prisma.Decimal(input.price) : service.price;
  const clientNote = normalizeOptionalNote(input.clientNote) ?? null;
  const internalNote = normalizeOptionalNote(input.internalNote) ?? null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      await lockMastersForUpdate(tx, [master.id]);
      await assertNoSlotOverlap(tx, {
        companyId: actor.companyId,
        masterId: master.id,
        startAt,
        endAt,
      });

      return tx.appointment.create({
        data: {
          companyId: actor.companyId,
          masterId: master.id,
          serviceId: service.id,
          clientName: input.clientName,
          clientPhone: input.clientPhone,
          clientNote,
          internalNote,
          startAt,
          endAt,
          price,
          status: AppointmentStatus.SCHEDULED,
          source: AppointmentSource.STAFF,
        },
        include: appointmentInclude,
      });
    });

    return serializeAppointment(created);
  } catch (err) {
    if (isExclusionConstraintError(err)) {
      throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Selected time slot is already booked');
    }
    throw err;
  }
}

export async function updateAppointmentForActor(
  actor: AuthenticatedActor,
  appointmentId: string,
  input: UpdateAppointmentBody,
): Promise<AppointmentDto> {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      companyId: actor.companyId,
      ...(actor.role === Role.MASTER ? { masterId: actor.userId } : {}),
    },
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  // BR-6: Editing/rescheduling only while SCHEDULED
  if (existing.status !== AppointmentStatus.SCHEDULED) {
    throw new AppError(
      'INVALID_STATUS_TRANSITION',
      409,
      'Only scheduled appointments can be edited or rescheduled',
    );
  }

  if (
    actor.role === Role.MASTER &&
    input.masterId !== undefined &&
    input.masterId !== actor.userId
  ) {
    throw new AppError('FORBIDDEN', 403, 'Masters cannot reassign appointments to another master');
  }

  const nextMasterId = input.masterId ?? existing.masterId;
  const nextServiceId = input.serviceId ?? existing.serviceId;
  const nextStartAt = input.startAt ?? existing.startAt;
  const masterChanged = nextMasterId !== existing.masterId;
  const serviceChanged = nextServiceId !== existing.serviceId;

  let nextEndAt: Date;
  let nextPrice: Prisma.Decimal;

  if (serviceChanged || masterChanged) {
    const { service } = await validateBookableMasterAndService(
      actor.companyId,
      nextMasterId,
      nextServiceId,
    );
    if (serviceChanged) {
      // BR-2: If serviceId changes on update, recompute endAt and (unless a price is given) the price snapshot
      nextEndAt = addMinutesUtc(nextStartAt, service.durationMin);
      nextPrice = input.price !== undefined ? new Prisma.Decimal(input.price) : service.price;
    } else {
      const currentDurationMs = existing.endAt.getTime() - existing.startAt.getTime();
      nextEndAt = addDurationMsUtc(nextStartAt, currentDurationMs);
      nextPrice = input.price !== undefined ? new Prisma.Decimal(input.price) : existing.price;
    }
  } else {
    const currentDurationMs = existing.endAt.getTime() - existing.startAt.getTime();
    nextEndAt = addDurationMsUtc(nextStartAt, currentDurationMs);
    nextPrice = input.price !== undefined ? new Prisma.Decimal(input.price) : existing.price;
  }

  const nextClientNote = normalizeOptionalNote(input.clientNote);
  const nextInternalNote = normalizeOptionalNote(input.internalNote);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockMastersForUpdate(tx, [existing.masterId, nextMasterId]);
      await assertNoSlotOverlap(tx, {
        companyId: actor.companyId,
        masterId: nextMasterId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        excludeAppointmentId: existing.id,
      });

      return tx.appointment.update({
        where: { id: existing.id },
        data: {
          masterId: nextMasterId,
          serviceId: nextServiceId,
          startAt: nextStartAt,
          endAt: nextEndAt,
          price: nextPrice,
          ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
          ...(input.clientPhone !== undefined ? { clientPhone: input.clientPhone } : {}),
          ...(nextClientNote !== undefined ? { clientNote: nextClientNote } : {}),
          ...(nextInternalNote !== undefined ? { internalNote: nextInternalNote } : {}),
        },
        include: appointmentInclude,
      });
    });

    return serializeAppointment(updated);
  } catch (err) {
    if (isExclusionConstraintError(err)) {
      throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Selected time slot is already booked');
    }
    throw err;
  }
}

export async function changeAppointmentStatusForActor(
  actor: AuthenticatedActor,
  appointmentId: string,
  input: UpdateAppointmentStatusBody,
): Promise<AppointmentDto> {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      companyId: actor.companyId,
      ...(actor.role === Role.MASTER ? { masterId: actor.userId } : {}),
    },
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  const nextStatus = input.status;
  const now = clockNow();

  if (existing.status === AppointmentStatus.SCHEDULED) {
    if (nextStatus === AppointmentStatus.CANCELLED) {
      const updated = await prisma.appointment.update({
        where: { id: existing.id },
        data: { status: AppointmentStatus.CANCELLED },
        include: appointmentInclude,
      });
      return serializeAppointment(updated);
    }

    if (nextStatus === AppointmentStatus.COMPLETED || nextStatus === AppointmentStatus.NO_SHOW) {
      // BR-6: COMPLETED and NO_SHOW only when startAt <= now
      if (existing.startAt.getTime() > now.getTime()) {
        throw new AppError(
          'INVALID_STATUS_TRANSITION',
          409,
          'Cannot mark a future appointment as completed or no-show before its start time',
        );
      }

      const updated = await prisma.appointment.update({
        where: { id: existing.id },
        data: { status: nextStatus },
        include: appointmentInclude,
      });
      return serializeAppointment(updated);
    }

    throw new AppError(
      'INVALID_STATUS_TRANSITION',
      409,
      `Cannot transition appointment from ${existing.status} to ${nextStatus}`,
    );
  }

  if (
    existing.status === AppointmentStatus.CANCELLED &&
    nextStatus === AppointmentStatus.SCHEDULED
  ) {
    // BR-6: CANCELLED -> SCHEDULED only by OWNER (re-runs BR-1)
    if (actor.role !== Role.OWNER) {
      throw new AppError('FORBIDDEN', 403, 'Only the owner can restore a cancelled appointment');
    }

    try {
      const restored = await prisma.$transaction(async (tx) => {
        await lockMastersForUpdate(tx, [existing.masterId]);
        await assertNoSlotOverlap(tx, {
          companyId: actor.companyId,
          masterId: existing.masterId,
          startAt: existing.startAt,
          endAt: existing.endAt,
          excludeAppointmentId: existing.id,
        });

        return tx.appointment.update({
          where: { id: existing.id },
          data: { status: AppointmentStatus.SCHEDULED },
          include: appointmentInclude,
        });
      });

      return serializeAppointment(restored);
    } catch (err) {
      if (isExclusionConstraintError(err)) {
        throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Selected time slot is already booked');
      }
      throw err;
    }
  }

  throw new AppError(
    'INVALID_STATUS_TRANSITION',
    409,
    `Cannot transition appointment from ${existing.status} to ${nextStatus}`,
  );
}

export async function deleteAppointmentForCompany(
  companyId: string,
  appointmentId: string,
): Promise<void> {
  const existing = await prisma.appointment.findFirst({
    where: { id: appointmentId, companyId },
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  await prisma.appointment.delete({
    where: { id: existing.id },
  });
}
