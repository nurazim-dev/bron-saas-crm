import { AppointmentStatus, NotificationChannel, Role } from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { utcToLocalParts } from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isExclusionConstraintError } from '../../middleware/error-handler.js';
import {
  assertNoSlotOverlap,
  lockMastersForUpdate,
  type TransactionClient,
} from '../appointments/appointments.service.js';
import {
  assertPublicSlotValidForSchedule,
  computeAvailableSlotsForDate,
} from '../availability/availability.service.js';
import { enqueue } from '../notifications/outbox.service.js';

export type ManageDisableReason =
  'WINDOW_CLOSED' | 'NOT_SCHEDULED' | 'RESCHEDULE_DISABLED' | 'RESCHEDULE_LIMIT';

export interface PublicManageAppointmentDto {
  id: string;
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  rescheduledCount: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  service: {
    id: string;
    name: string;
    durationMin: number;
    price: string;
  };
  master: {
    id: string;
    name: string;
  };
  company: {
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    timezone: string;
    currency: string;
    clientCancelMinHours: number;
    allowClientReschedule: boolean;
  };
  actions: {
    canCancel: boolean;
    cancelDisabledReason: ManageDisableReason | null;
    canReschedule: boolean;
    rescheduleDisabledReason: ManageDisableReason | null;
  };
}

const MAX_CLIENT_RESCHEDULES = 2;

function computeActions(
  appt: {
    status: AppointmentStatus;
    startAt: Date;
    rescheduledCount: number;
  },
  company: {
    clientCancelMinHours: number;
    allowClientReschedule: boolean;
  },
  currentNow: Date,
): PublicManageAppointmentDto['actions'] {
  const cutoffMs = appt.startAt.getTime() - company.clientCancelMinHours * 3_600_000;
  const withinWindow = currentNow.getTime() <= cutoffMs;

  let cancelDisabledReason: ManageDisableReason | null = null;
  if (appt.status !== AppointmentStatus.SCHEDULED) {
    cancelDisabledReason = 'NOT_SCHEDULED';
  } else if (!withinWindow) {
    cancelDisabledReason = 'WINDOW_CLOSED';
  }

  let rescheduleDisabledReason: ManageDisableReason | null = null;
  if (!company.allowClientReschedule) {
    rescheduleDisabledReason = 'RESCHEDULE_DISABLED';
  } else if (appt.status !== AppointmentStatus.SCHEDULED) {
    rescheduleDisabledReason = 'NOT_SCHEDULED';
  } else if (!withinWindow) {
    rescheduleDisabledReason = 'WINDOW_CLOSED';
  } else if (appt.rescheduledCount >= MAX_CLIENT_RESCHEDULES) {
    rescheduleDisabledReason = 'RESCHEDULE_LIMIT';
  }

  return {
    canCancel: cancelDisabledReason === null,
    cancelDisabledReason,
    canReschedule: rescheduleDisabledReason === null,
    rescheduleDisabledReason,
  };
}

async function resolveManageAppointment(token: string) {
  const appt = await prisma.appointment.findUnique({
    where: { manageToken: token },
    include: {
      company: true,
      service: true,
      master: true,
    },
  });

  if (
    !appt ||
    appt.deletedAt !== null ||
    appt.company.deletedAt !== null ||
    appt.company.suspendedAt
  ) {
    throw new AppError('NOT_FOUND', 404, 'Appointment not found');
  }

  return appt;
}

function serializeManageAppointment(
  appt: Awaited<ReturnType<typeof resolveManageAppointment>>,
  currentNow: Date,
): PublicManageAppointmentDto {
  return {
    id: appt.id,
    status: appt.status,
    startAt: appt.startAt.toISOString(),
    endAt: appt.endAt.toISOString(),
    rescheduledCount: appt.rescheduledCount,
    cancelledAt: appt.cancelledAt ? appt.cancelledAt.toISOString() : null,
    cancelledBy: appt.cancelledBy,
    cancelReason: appt.cancelReason,
    service: {
      id: appt.service.id,
      name: appt.service.name,
      durationMin: appt.service.durationMin,
      price: appt.price.toFixed(2),
    },
    master: {
      id: appt.master.id,
      name: appt.master.name,
    },
    company: {
      name: appt.company.name,
      slug: appt.company.slug,
      address: appt.company.address,
      phone: appt.company.phone,
      timezone: appt.company.timezone,
      currency: appt.company.currency,
      clientCancelMinHours: appt.company.clientCancelMinHours,
      allowClientReschedule: appt.company.allowClientReschedule,
    },
    actions: computeActions(appt, appt.company, currentNow),
  };
}

async function notifyStaffOnClientChange(
  tx: TransactionClient,
  params: {
    kind: 'CLIENT_CANCELLED' | 'CLIENT_RESCHEDULED';
    appointmentId: string;
    companyId: string;
    masterId: string;
    serviceName: string;
    clientName: string;
    startAt: Date;
    timezone: string;
    suffix: string;
  },
) {
  const owner = await tx.user.findFirst({
    where: {
      companyId: params.companyId,
      role: Role.OWNER,
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, email: true },
  });

  const master = await tx.user.findFirst({
    where: {
      id: params.masterId,
      companyId: params.companyId,
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, email: true },
  });

  const recipients = new Map<string, { id: string; email: string | null }>();
  if (owner) recipients.set(owner.id, owner);
  if (master) recipients.set(master.id, master);

  const localParts = utcToLocalParts(params.startAt, params.timezone);
  const title =
    params.kind === 'CLIENT_CANCELLED'
      ? `Клиент отменил запись: ${params.clientName}`
      : `Клиент перенёс запись: ${params.clientName}`;
  const body = `${params.serviceName} • ${localParts.date} ${localParts.time}`;

  for (const recipient of recipients.values()) {
    await tx.inAppNotification.create({
      data: {
        companyId: params.companyId,
        userId: recipient.id,
        kind: params.kind,
        title,
        body,
        data: { appointmentId: params.appointmentId },
      },
    });

    if (recipient.email) {
      await enqueue(tx, {
        companyId: params.companyId,
        channel: NotificationChannel.EMAIL,
        kind: params.kind,
        recipient: recipient.email,
        toUserId: recipient.id,
        appointmentId: params.appointmentId,
        payload: {
          subject: title,
          text: `${title}\n${body}`,
        },
        dedupeKey: `staff:${params.kind}:${params.appointmentId}:${recipient.id}:${params.suffix}`,
      });
    }
  }
}

export async function getPublicManageAppointment(
  token: string,
): Promise<PublicManageAppointmentDto> {
  const appt = await resolveManageAppointment(token);
  return serializeManageAppointment(appt, clockNow());
}

export async function getPublicManageAvailability(token: string, date: string) {
  const appt = await resolveManageAppointment(token);
  return computeAvailableSlotsForDate(prisma, {
    company: appt.company,
    service: appt.service,
    master: appt.master,
    date,
    now: clockNow(),
  });
}

export async function cancelPublicManageAppointment(
  token: string,
  input: { reason?: string | null },
  auditCtx?: AuditRequestContext,
): Promise<PublicManageAppointmentDto> {
  const currentNow = clockNow();
  const appt = await resolveManageAppointment(token);
  const actions = computeActions(appt, appt.company, currentNow);

  if (!actions.canCancel) {
    throw new AppError('CHANGE_NOT_ALLOWED', 422, 'Appointment cannot be cancelled', [
      {
        reason: actions.cancelDisabledReason ?? 'NOT_SCHEDULED',
        message: 'Appointment cannot be cancelled',
      },
    ]);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.appointment.update({
      where: { id: appt.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledBy: 'CLIENT',
        cancelledAt: currentNow,
        cancelReason: input.reason ?? null,
      },
      include: {
        company: true,
        service: true,
        master: true,
      },
    });

    await notifyStaffOnClientChange(tx, {
      kind: 'CLIENT_CANCELLED',
      appointmentId: row.id,
      companyId: row.companyId,
      masterId: row.masterId,
      serviceName: row.service.name,
      clientName: row.clientName,
      startAt: row.startAt,
      timezone: row.company.timezone,
      suffix: 'cancel',
    });

    await audit(tx, {
      actorType: 'SYSTEM',
      companyId: row.companyId,
      action: 'appointment.client_cancel',
      entityType: 'Appointment',
      entityId: row.id,
      metadata: { reason: input.reason ?? null },
      ...auditCtx,
    });

    return row;
  });

  return serializeManageAppointment(updated, currentNow);
}

export async function reschedulePublicManageAppointment(
  token: string,
  input: { startAt: Date },
  auditCtx?: AuditRequestContext,
): Promise<PublicManageAppointmentDto> {
  const currentNow = clockNow();
  const appt = await resolveManageAppointment(token);
  const actions = computeActions(appt, appt.company, currentNow);

  if (!actions.canReschedule) {
    throw new AppError('CHANGE_NOT_ALLOWED', 422, 'Appointment cannot be rescheduled', [
      {
        reason: actions.rescheduleDisabledReason ?? 'NOT_SCHEDULED',
        message: 'Appointment cannot be rescheduled',
      },
    ]);
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockMastersForUpdate(tx, [appt.masterId]);

      const { endAt } = await assertPublicSlotValidForSchedule(tx, {
        company: appt.company,
        service: appt.service,
        master: appt.master,
        startAt: input.startAt,
        now: currentNow,
      });

      await assertNoSlotOverlap(tx, {
        companyId: appt.companyId,
        masterId: appt.masterId,
        startAt: input.startAt,
        endAt,
        excludeAppointmentId: appt.id,
      });

      const row = await tx.appointment.update({
        where: { id: appt.id },
        data: {
          startAt: input.startAt,
          endAt,
          rescheduledCount: { increment: 1 },
        },
        include: {
          company: true,
          service: true,
          master: true,
        },
      });

      await notifyStaffOnClientChange(tx, {
        kind: 'CLIENT_RESCHEDULED',
        appointmentId: row.id,
        companyId: row.companyId,
        masterId: row.masterId,
        serviceName: row.service.name,
        clientName: row.clientName,
        startAt: row.startAt,
        timezone: row.company.timezone,
        suffix: `r${row.rescheduledCount}`,
      });

      await audit(tx, {
        actorType: 'SYSTEM',
        companyId: row.companyId,
        action: 'appointment.client_reschedule',
        entityType: 'Appointment',
        entityId: row.id,
        metadata: {
          previousStartAt: appt.startAt.toISOString(),
          newStartAt: row.startAt.toISOString(),
          rescheduledCount: row.rescheduledCount,
        },
        ...auditCtx,
      });

      return row;
    });

    return serializeManageAppointment(updated, currentNow);
  } catch (err) {
    if (isExclusionConstraintError(err)) {
      throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Selected time slot is already booked');
    }
    throw err;
  }
}
