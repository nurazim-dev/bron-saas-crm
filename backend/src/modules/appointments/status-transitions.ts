import { AppointmentStatus, Role } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';

/** Statuses that occupy a master's time slot (must match DB EXCLUDE constraint). */
export const ACTIVE_SLOT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
  AppointmentStatus.COMPLETED,
];

/** Active upcoming statuses (count against phone limits, block staff/service deletion, time-off warnings). */
export const UPCOMING_ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
];

/** Statuses in which staff/client may still reschedule or edit appointment details. */
export const EDITABLE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

/** Statuses eligible for sending reminders or prepayment hold expiry. */
export const REMINDABLE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
];

/** Explicit Core Booking appointment status transition table. */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  [AppointmentStatus.SCHEDULED]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.SCHEDULED,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.IN_PROGRESS]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.CANCELLED]: [AppointmentStatus.SCHEDULED],
  [AppointmentStatus.COMPLETED]: [],
  [AppointmentStatus.NO_SHOW]: [],
};

export function assertValidStatusTransition(params: {
  from: AppointmentStatus;
  to: AppointmentStatus;
  actorRole: Role;
  startAt: Date;
  now: Date;
}): void {
  const { from, to, actorRole, startAt, now } = params;
  const allowed = ALLOWED_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new AppError(
      'INVALID_STATUS_TRANSITION',
      409,
      `Cannot transition appointment from ${from} to ${to}`,
    );
  }

  if (from === AppointmentStatus.CANCELLED && to === AppointmentStatus.SCHEDULED) {
    if (actorRole !== Role.OWNER) {
      throw new AppError('FORBIDDEN', 403, 'Only the owner can restore a cancelled appointment');
    }
  }

  if (from === AppointmentStatus.IN_PROGRESS && to === AppointmentStatus.CANCELLED) {
    if (actorRole !== Role.OWNER && actorRole !== Role.MANAGER) {
      throw new AppError(
        'FORBIDDEN',
        403,
        'Only owner or manager can cancel an in-progress appointment',
      );
    }
  }

  if (to === AppointmentStatus.COMPLETED || to === AppointmentStatus.NO_SHOW) {
    if (startAt.getTime() > now.getTime()) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        409,
        'Cannot mark a future appointment as completed or no-show before its start time',
      );
    }
  }
}
