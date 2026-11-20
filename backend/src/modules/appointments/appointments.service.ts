import { resolveServiceSelection, selectionIds, snapshotServices } from './service-selection.js';
import {
  ACTIVE_SLOT_STATUSES,
  assertValidStatusTransition,
  EDITABLE_APPOINTMENT_STATUSES,
} from './status-transitions.js';
import { randomBytes } from 'node:crypto';
import {
  AppointmentSource,
  AppointmentStatus,
  AuditActor,
  PrepaymentStatus,
  Prisma,
  Role,
  type Appointment,
  type AppointmentService,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import {
  addDurationMsUtc,
  addMinutesUtc,
  localDateTimeToUtc,
  utcToLocalParts,
} from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isExclusionConstraintError } from '../../middleware/error-handler.js';
import type { AuthenticatedActor } from '../../types/express.js';
import { assertWithinMonthlyAppointmentLimit } from '../billing/billing.service.js';
import { upsertClientInTx } from '../clients/clients.service.js';
import {
  cancelPendingReminders,
  scheduleAppointmentReminders,
} from '../notifications/reminders.service.js';
import { notifyCompanyStaff } from '../notifications/staff-notify.service.js';
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

export type AppointmentScheduleWarning =
  'OUTSIDE_WORKING_HOURS' | 'DURING_BREAK' | 'DURING_TIME_OFF';

export interface AppointmentDto {
  id: string;
  companyId: string;
  masterId: string;
  serviceId: string;
  serviceIds: string[];
  packageId: string | null;
  packageName: string | null;
  clientId: string;
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
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  rescheduledCount: number;
  prepaymentStatus: PrepaymentStatus;
  prepaymentAmount: string | null;
  prepaymentHoldUntil: string | null;
  prepaymentReceivedAt: string | null;
  warnings?: AppointmentScheduleWarning[];
  createdAt: string;
  updatedAt: string;
}

type AppointmentWithRelations = Appointment & {
  items?: AppointmentService[];
  service: { id: string; name: string; durationMin: number };
  master: { id: string; name: string };
};

export const appointmentInclude = {
  items: { orderBy: { position: 'asc' } },
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

async function computeScheduleWarnings(
  tx: TransactionClient,
  params: { companyId: string; masterId: string; startAt: Date; endAt: Date },
): Promise<AppointmentScheduleWarning[]> {
  const company = await tx.company.findUnique({
    where: { id: params.companyId },
    select: { timezone: true },
  });
  if (!company) return [];

  const localParts = utcToLocalParts(params.startAt, company.timezone);
  // A transaction owns a single pg connection; execute its queries sequentially.
  const workingHours = await tx.workingHours.findUnique({
    where: {
      userId_dayOfWeek: {
        userId: params.masterId,
        dayOfWeek: localParts.dayOfWeek,
      },
    },
  });
  const overlappingTimeOff = await tx.timeOff.findFirst({
    where: {
      companyId: params.companyId,
      userId: params.masterId,
      startAt: { lt: params.endAt },
      endAt: { gt: params.startAt },
    },
    select: { id: true },
  });
  const warnings: AppointmentScheduleWarning[] = [];
  if (!workingHours) {
    warnings.push('OUTSIDE_WORKING_HOURS');
  } else {
    const workStart = localDateTimeToUtc(localParts.date, workingHours.startTime, company.timezone);
    const workEnd = localDateTimeToUtc(localParts.date, workingHours.endTime, company.timezone);
    if (params.startAt < workStart || params.endAt > workEnd) {
      warnings.push('OUTSIDE_WORKING_HOURS');
    }
    if (workingHours.breakStart && workingHours.breakEnd) {
      const breakStart = localDateTimeToUtc(
        localParts.date,
        workingHours.breakStart,
        company.timezone,
      );
      const breakEnd = localDateTimeToUtc(localParts.date, workingHours.breakEnd, company.timezone);
      if (breakStart < params.endAt && breakEnd > params.startAt) {
        warnings.push('DURING_BREAK');
      }
    }
  }

  if (overlappingTimeOff) {
    warnings.push('DURING_TIME_OFF');
  }

  return warnings;
}

export function serializeAppointment(
  appt: AppointmentWithRelations,
  warnings?: AppointmentScheduleWarning[],
): AppointmentDto {
  return {
    id: appt.id,
    companyId: appt.companyId,
    masterId: appt.masterId,
    serviceId: appt.serviceId,
    serviceIds: appt.items?.length ? appt.items.map((item) => item.serviceId) : [appt.serviceId],
    packageId: appt.packageId ?? null,
    packageName: appt.packageName ?? null,
    clientId: appt.clientId,
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
      name:
        appt.packageName ??
        (appt.items?.length ? appt.items.map((item) => item.name).join(' + ') : appt.service.name),
      durationMin: (appt.endAt.getTime() - appt.startAt.getTime()) / 60000,
    },
    master: {
      id: appt.master.id,
      name: appt.master.name,
    },
    cancelledAt: appt.cancelledAt ? appt.cancelledAt.toISOString() : null,
    cancelledBy: appt.cancelledBy,
    cancelReason: appt.cancelReason,
    rescheduledCount: appt.rescheduledCount,
    prepaymentStatus: appt.prepaymentStatus,
    prepaymentAmount: appt.prepaymentAmount ? appt.prepaymentAmount.toFixed(2) : null,
    prepaymentHoldUntil: appt.prepaymentHoldUntil ? appt.prepaymentHoldUntil.toISOString() : null,
    prepaymentReceivedAt: appt.prepaymentReceivedAt
      ? appt.prepaymentReceivedAt.toISOString()
      : null,
    ...(warnings !== undefined ? { warnings } : {}),
    createdAt: appt.createdAt.toISOString(),
    updatedAt: appt.updatedAt.toISOString(),
  };
}

const BLOCKING_STATUSES: AppointmentStatus[] = [...ACTIVE_SLOT_STATUSES];

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

async function validateBookableMaster(companyId: string, masterId: string) {
  const master = await prisma.user.findFirst({
    where: { id: masterId, companyId },
  });
  if (!master) {
    throw new AppError('NOT_FOUND', 404, 'Master not found');
  }
  if (!master.isActive || !master.isBookable) {
    throw new AppError('VALIDATION_ERROR', 400, 'Selected master is not active or not bookable', [
      { path: 'masterId', message: 'Selected master is not active or not bookable' },
    ]);
  }
  return master;
}

async function validateBookableMasterAndService(
  companyId: string,
  masterId: string,
  serviceId: string,
) {
  const [master, service] = await Promise.all([
    validateBookableMaster(companyId, masterId),
    prisma.service.findFirst({
      where: { id: serviceId, companyId },
    }),
  ]);
  if (!service) {
    throw new AppError('NOT_FOUND', 404, 'Service not found');
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
    ...(query.prepaymentStatus !== undefined ? { prepaymentStatus: query.prepaymentStatus } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
    }),
    prisma.appointment.count({ where }),
  ]);

  return {
    data: rows.map((r) => serializeAppointment(r)),
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

  const master = await validateBookableMaster(actor.companyId, input.masterId);

  const startAt = input.startAt;
  await assertWithinMonthlyAppointmentLimit(actor.companyId, startAt);
  const clientNote = normalizeOptionalNote(input.clientNote) ?? null;
  const internalNote = normalizeOptionalNote(input.internalNote) ?? null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      await lockMastersForUpdate(tx, [master.id]);
      const { service, services, packageRef } = await resolveServiceSelection(
        tx,
        actor.companyId,
        input.serviceId,
        input.serviceIds,
        master.id,
        input.packageId,
      );
      const endAt = addMinutesUtc(startAt, service.durationMin);
      const price = input.price !== undefined ? new Prisma.Decimal(input.price) : service.price;
      await assertNoSlotOverlap(tx, {
        companyId: actor.companyId,
        masterId: master.id,
        startAt,
        endAt,
      });

      const client = await upsertClientInTx(tx, {
        companyId: actor.companyId,
        name: input.clientName,
        phone: input.clientPhone,
        overwriteName: true,
        currentTime: clockNow(),
      });

      const warnings = await computeScheduleWarnings(tx, {
        companyId: actor.companyId,
        masterId: master.id,
        startAt,
        endAt,
      });

      const created = await tx.appointment.create({
        data: {
          companyId: actor.companyId,
          masterId: master.id,
          serviceId: service.id,
          packageId: packageRef?.id ?? null,
          packageName: packageRef?.name ?? null,
          items: { create: snapshotServices(services) },
          clientId: client.id,
          clientName: input.clientName,
          clientPhone: input.clientPhone,
          clientNote,
          internalNote,
          startAt,
          endAt,
          price,
          status: AppointmentStatus.SCHEDULED,
          source: AppointmentSource.STAFF,
          manageToken: randomBytes(32).toString('base64url'),
        },
        include: appointmentInclude,
      });

      const company = await tx.company.findUnique({
        where: { id: actor.companyId },
        select: {
          id: true,
          name: true,
          address: true,
          timezone: true,
          reminderMode: true,
          remind24h: true,
          remind2h: true,
        },
      });

      if (company) {
        if (actor.userId !== master.id) {
          await notifyCompanyStaff(tx, {
            kind: 'STAFF_BOOKING_FOR_MASTER',
            companyId: company.id,
            companyName: company.name,
            timezone: company.timezone,
            appointmentId: created.id,
            masterId: master.id,
            masterName: master.name,
            serviceName: service.name,
            clientName: created.clientName,
            startAt: created.startAt,
            dedupeSuffix: 'create',
            includeOwner: false,
            excludeUserId: actor.userId,
          });
        }
        await scheduleAppointmentReminders(tx, {
          appointment: created,
          company,
          serviceName: service.name,
        });
      }

      return { created, warnings };
    });

    return serializeAppointment(created.created, created.warnings);
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
    include: appointmentInclude,
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  // BR-6: Editing/rescheduling only while SCHEDULED or CONFIRMED
  if (!EDITABLE_APPOINTMENT_STATUSES.includes(existing.status)) {
    throw new AppError(
      'INVALID_STATUS_TRANSITION',
      409,
      'Only scheduled or confirmed appointments can be edited or rescheduled',
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
  const existingIds = existing.items.length
    ? existing.items.map((item) => item.serviceId)
    : [existing.serviceId];
  const nextIds = selectionIds(
    nextServiceId,
    input.serviceIds ?? (nextServiceId !== existing.serviceId ? [nextServiceId] : existingIds),
  );
  const serviceChanged = JSON.stringify(nextIds) !== JSON.stringify(existingIds);

  let nextEndAt: Date;
  let nextPrice: Prisma.Decimal;

  if (serviceChanged || masterChanged) {
    await validateBookableMasterAndService(actor.companyId, nextMasterId, nextServiceId);
    const { service } = await resolveServiceSelection(
      prisma,
      actor.companyId,
      nextServiceId,
      nextIds,
      nextMasterId,
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
      const selection =
        serviceChanged || masterChanged
          ? await resolveServiceSelection(tx, actor.companyId, nextServiceId, nextIds, nextMasterId)
          : null;
      if (serviceChanged && selection) {
        nextEndAt = addMinutesUtc(nextStartAt, selection.service.durationMin);
        nextPrice =
          input.price !== undefined ? new Prisma.Decimal(input.price) : selection.service.price;
        await tx.appointmentService.deleteMany({
          where: { appointmentId: existing.id, companyId: actor.companyId },
        });
      }
      await assertNoSlotOverlap(tx, {
        companyId: actor.companyId,
        masterId: nextMasterId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        excludeAppointmentId: existing.id,
      });

      let nextClientId: string | undefined;
      if (input.clientName !== undefined || input.clientPhone !== undefined) {
        const upserted = await upsertClientInTx(tx, {
          companyId: actor.companyId,
          name: input.clientName ?? existing.clientName,
          phone: input.clientPhone ?? existing.clientPhone,
          overwriteName: true,
          currentTime: clockNow(),
        });
        nextClientId = upserted.id;
      }

      const warnings = await computeScheduleWarnings(tx, {
        companyId: actor.companyId,
        masterId: nextMasterId,
        startAt: nextStartAt,
        endAt: nextEndAt,
      });

      const appt = await tx.appointment.update({
        where: { id: existing.id, companyId: actor.companyId },
        data: {
          ...(serviceChanged && selection
            ? {
                packageId: null,
                packageName: null,
                items: { create: snapshotServices(selection.services) },
              }
            : {}),
          masterId: nextMasterId,
          serviceId: nextServiceId,
          startAt: nextStartAt,
          endAt: nextEndAt,
          price: nextPrice,
          ...(nextClientId !== undefined ? { clientId: nextClientId } : {}),
          ...(input.clientName !== undefined ? { clientName: input.clientName } : {}),
          ...(input.clientPhone !== undefined ? { clientPhone: input.clientPhone } : {}),
          ...(nextClientNote !== undefined ? { clientNote: nextClientNote } : {}),
          ...(nextInternalNote !== undefined ? { internalNote: nextInternalNote } : {}),
        },
        include: appointmentInclude,
      });

      if (input.startAt !== undefined || input.clientPhone !== undefined) {
        await cancelPendingReminders(tx, appt.id);
        const company = await tx.company.findUnique({
          where: { id: actor.companyId },
          select: {
            id: true,
            name: true,
            address: true,
            timezone: true,
            reminderMode: true,
            remind24h: true,
            remind2h: true,
          },
        });
        if (company) {
          await scheduleAppointmentReminders(tx, {
            appointment: appt,
            company,
            serviceName: serializeAppointment(appt).service.name,
          });
        }
      }

      return { appt, warnings };
    });

    return serializeAppointment(updated.appt, updated.warnings);
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

  assertValidStatusTransition({
    from: existing.status,
    to: nextStatus,
    actorRole: actor.role,
    startAt: existing.startAt,
    now,
  });

  if (nextStatus === AppointmentStatus.CANCELLED) {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: existing.id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledBy: 'STAFF',
          cancelledAt: now,
        },
        include: appointmentInclude,
      });
      await cancelPendingReminders(tx, row.id);
      return row;
    });
    return serializeAppointment(updated);
  }

  if (nextStatus === AppointmentStatus.COMPLETED || nextStatus === AppointmentStatus.NO_SHOW) {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: existing.id },
        data: { status: nextStatus },
        include: appointmentInclude,
      });
      await cancelPendingReminders(tx, row.id);
      return row;
    });
    return serializeAppointment(updated);
  }

  if (
    existing.status === AppointmentStatus.CANCELLED &&
    nextStatus === AppointmentStatus.SCHEDULED
  ) {
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
          data: {
            status: AppointmentStatus.SCHEDULED,
            cancelledAt: null,
            cancelledBy: null,
            cancelReason: null,
          },
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

  const updated = await prisma.appointment.update({
    where: { id: existing.id },
    data: { status: nextStatus },
    include: appointmentInclude,
  });
  return serializeAppointment(updated);
}

export async function deleteAppointmentForCompany(
  companyId: string,
  appointmentId: string,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<void> {
  const existing = await prisma.appointment.findFirst({
    where: { id: appointmentId, companyId },
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  await prisma.$transaction(async (tx) => {
    await cancelPendingReminders(tx, existing.id);
    await tx.appointment.delete({
      where: { id: existing.id },
    });
  });

  await audit(prisma, {
    actorType: AuditActor.USER,
    actorId: auditMeta?.actorId ?? null,
    companyId,
    action: 'appointment.delete',
    entityType: 'Appointment',
    entityId: existing.id,
    metadata: {
      masterId: existing.masterId,
      status: existing.status,
      startAt: existing.startAt.toISOString(),
    },
    context: auditMeta?.context,
  });
}

export async function applyPrepaymentAction(
  actor: AuthenticatedActor,
  appointmentId: string,
  action: 'RECEIVED' | 'WAIVE' | 'REFUND',
  context?: AuditRequestContext,
): Promise<AppointmentDto> {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      companyId: actor.companyId,
      ...(actor.role === Role.MASTER ? { masterId: actor.userId } : {}),
    },
    include: appointmentInclude,
  });

  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  if (action === 'REFUND' && actor.role !== Role.OWNER) {
    throw new AppError('FORBIDDEN', 403, 'Only the business owner can refund a prepayment');
  }

  if (!EDITABLE_APPOINTMENT_STATUSES.includes(existing.status) && action !== 'REFUND') {
    throw new AppError(
      'INVALID_STATUS_TRANSITION',
      409,
      'Prepayment status can only be updated for scheduled or confirmed appointments',
    );
  }

  const currentNow = clockNow();
  const expectedFrom: PrepaymentStatus =
    action === 'REFUND' ? PrepaymentStatus.RECEIVED : PrepaymentStatus.PENDING;

  const nextData: Prisma.AppointmentUpdateManyMutationInput =
    action === 'RECEIVED'
      ? {
          prepaymentStatus: PrepaymentStatus.RECEIVED,
          prepaymentReceivedAt: currentNow,
          prepaymentHoldUntil: null,
        }
      : action === 'WAIVE'
        ? {
            prepaymentStatus: PrepaymentStatus.NOT_REQUIRED,
            prepaymentHoldUntil: null,
          }
        : {
            prepaymentStatus: PrepaymentStatus.REFUNDED,
          };

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.appointment.updateMany({
      where: {
        id: existing.id,
        companyId: actor.companyId,
        deletedAt: null,
        prepaymentStatus: expectedFrom,
        ...(action !== 'REFUND' ? { status: { in: [...EDITABLE_APPOINTMENT_STATUSES] } } : {}),
      },
      data: nextData,
    });

    if (res.count === 0) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        409,
        `Cannot apply prepayment action ${action} from status ${existing.prepaymentStatus}`,
      );
    }

    const row = await tx.appointment.findUnique({
      where: { id: existing.id },
      include: appointmentInclude,
    });
    if (!row) {
      throw new AppError('NOT_FOUND', 404, 'Appointment not found');
    }

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: actor.userId,
      companyId: actor.companyId,
      action: `appointment.prepayment.${action.toLowerCase()}`,
      entityType: 'Appointment',
      entityId: existing.id,
      metadata: {
        previousStatus: existing.prepaymentStatus,
        nextStatus: row.prepaymentStatus,
        amount: row.prepaymentAmount?.toFixed(2) ?? null,
      },
      context,
    });

    return row;
  });

  return serializeAppointment(updated);
}
