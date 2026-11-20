import { resolveServiceSelection } from '../appointments/service-selection.js';
import { ACTIVE_SLOT_STATUSES } from '../appointments/status-transitions.js';
import {
  Role,
  type AppointmentStatus,
  type Company,
  type Service,
  type User,
} from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import {
  addDaysToLocalDate,
  addDurationMsUtc,
  epochMsToUtcDate,
  getIsoWeekdayOfLocalDate,
  getTodayLocalDate,
  localDateTimeToUtc,
  utcToLocalParts,
} from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { AuthenticatedActor } from '../../types/express.js';
import type { TransactionClient } from '../appointments/appointments.service.js';
import type { GetAvailabilityQuery } from './availability.schemas.js';

export type DbClient = typeof prisma | TransactionClient;

export interface AvailableSlotDto {
  startAt: string;
  label: string;
}

export interface AvailabilityResultDto {
  date: string;
  timezone: string;
  slots: AvailableSlotDto[];
}

const BLOCKING_STATUSES: AppointmentStatus[] = [...ACTIVE_SLOT_STATUSES];

/**
 * Shared BR-4 availability engine used by both staff (`/api/v1/availability`)
 * and public (`/api/v1/public/companies/:slug/availability` + booking re-validation).
 */
export async function computeAvailableSlotsForDate(
  db: DbClient,
  params: {
    company: Pick<
      Company,
      'id' | 'timezone' | 'slotIntervalMin' | 'minLeadTimeMin' | 'maxAdvanceDays'
    >;
    service: Pick<Service, 'id' | 'durationMin'>;
    master: Pick<User, 'id'>;
    date: string;
    now?: Date;
  },
): Promise<AvailabilityResultDto> {
  const { company, service, master, date } = params;
  const now = params.now ?? clockNow();

  // 1. Date before company-local today or after today + maxAdvanceDays -> no slots
  const todayLocal = getTodayLocalDate(company.timezone, now);
  const maxLocalDate = addDaysToLocalDate(todayLocal, company.maxAdvanceDays, company.timezone);
  if (date < todayLocal || date > maxLocalDate) {
    return {
      date,
      timezone: company.timezone,
      slots: [],
    };
  }

  // 2. Take the master's WorkingHours row for the ISO weekday of that local date; none -> no slots
  const dayOfWeek = getIsoWeekdayOfLocalDate(date, company.timezone);
  const workingHours = await db.workingHours.findUnique({
    where: {
      userId_dayOfWeek: {
        userId: master.id,
        dayOfWeek,
      },
    },
  });

  if (!workingHours) {
    return {
      date,
      timezone: company.timezone,
      slots: [],
    };
  }

  // 3. Convert [date+startTime, date+endTime) from the company timezone to UTC
  const workStartUtc = localDateTimeToUtc(date, workingHours.startTime, company.timezone);
  const workEndUtc = localDateTimeToUtc(date, workingHours.endTime, company.timezone);
  const workStartMs = workStartUtc.getTime();
  const workEndMs = workEndUtc.getTime();

  const durationMs = service.durationMin * 60_000;
  const stepMs = company.slotIntervalMin * 60_000;
  const minAllowedStartMs = now.getTime() + company.minLeadTimeMin * 60_000;

  if (workStartMs + durationMs > workEndMs) {
    return {
      date,
      timezone: company.timezone,
      slots: [],
    };
  }

  // 4. Load the master's blocking appointments and TimeOff rows overlapping that window
  // A transaction owns a single pg connection; execute its queries sequentially.
  const blockingAppointments = await db.appointment.findMany({
    where: {
      companyId: company.id,
      masterId: master.id,
      deletedAt: null,
      status: { in: BLOCKING_STATUSES },
      startAt: { lt: workEndUtc },
      endAt: { gt: workStartUtc },
    },
    select: {
      startAt: true,
      endAt: true,
    },
    orderBy: { startAt: 'asc' },
  });
  const timeOffs = await db.timeOff.findMany({
    where: {
      companyId: company.id,
      userId: master.id,
      startAt: { lt: workEndUtc },
      endAt: { gt: workStartUtc },
    },
    select: {
      startAt: true,
      endAt: true,
    },
  });
  const breakStartMs = workingHours.breakStart
    ? localDateTimeToUtc(date, workingHours.breakStart, company.timezone).getTime()
    : null;
  const breakEndMs = workingHours.breakEnd
    ? localDateTimeToUtc(date, workingHours.breakEnd, company.timezone).getTime()
    : null;

  // 5 & 6. Generate candidate starts and drop those overlapping a blocking appointment, break, time off, or < now + minLeadTimeMin
  const slots: AvailableSlotDto[] = [];

  for (
    let candidateStartMs = workStartMs;
    candidateStartMs + durationMs <= workEndMs;
    candidateStartMs += stepMs
  ) {
    if (candidateStartMs < minAllowedStartMs) {
      continue;
    }

    const candidateEndMs = candidateStartMs + durationMs;
    const overlapsExisting = blockingAppointments.some(
      (appt) => appt.startAt.getTime() < candidateEndMs && appt.endAt.getTime() > candidateStartMs,
    );
    if (overlapsExisting) {
      continue;
    }

    const overlapsBreak =
      breakStartMs !== null &&
      breakEndMs !== null &&
      breakStartMs < candidateEndMs &&
      breakEndMs > candidateStartMs;
    if (overlapsBreak) {
      continue;
    }

    const overlapsTimeOff = timeOffs.some(
      (to) => to.startAt.getTime() < candidateEndMs && to.endAt.getTime() > candidateStartMs,
    );
    if (overlapsTimeOff) {
      continue;
    }

    const candidateDate = epochMsToUtcDate(candidateStartMs);
    const localParts = utcToLocalParts(candidateDate, company.timezone);
    slots.push({
      startAt: candidateDate.toISOString(),
      label: localParts.time,
    });
  }

  return {
    date,
    timezone: company.timezone,
    slots,
  };
}

/**
 * Validates that a requested `startAt` satisfies BR-3 schedule, grid, lead-time, and max-advance rules
 * (everything in BR-4 except appointment overlap, which is checked separately to return 409 vs 422).
 * Throws `422 SLOT_NOT_AVAILABLE` on any violation.
 */
export async function assertPublicSlotValidForSchedule(
  db: DbClient,
  params: {
    company: Pick<
      Company,
      'id' | 'timezone' | 'slotIntervalMin' | 'minLeadTimeMin' | 'maxAdvanceDays'
    >;
    service: Pick<Service, 'id' | 'durationMin'>;
    master: Pick<User, 'id'>;
    startAt: Date;
    now?: Date;
  },
): Promise<{ localDate: string; endAt: Date }> {
  const { company, service, master, startAt } = params;
  const now = params.now ?? clockNow();

  const localParts = utcToLocalParts(startAt, company.timezone);
  const localDate = localParts.date;

  const todayLocal = getTodayLocalDate(company.timezone, now);
  const maxLocalDate = addDaysToLocalDate(todayLocal, company.maxAdvanceDays, company.timezone);

  if (localDate < todayLocal || localDate > maxLocalDate) {
    throw new AppError(
      'SLOT_NOT_AVAILABLE',
      422,
      'Selected date is outside the allowed booking window',
    );
  }

  const minAllowedStartMs = now.getTime() + company.minLeadTimeMin * 60_000;
  const maxAllowedStartMs = now.getTime() + company.maxAdvanceDays * 24 * 60 * 60_000;
  if (startAt.getTime() < minAllowedStartMs || startAt.getTime() > maxAllowedStartMs) {
    throw new AppError(
      'SLOT_NOT_AVAILABLE',
      422,
      'Selected time does not satisfy lead-time or advance-booking limits',
    );
  }

  const workingHours = await db.workingHours.findUnique({
    where: {
      userId_dayOfWeek: {
        userId: master.id,
        dayOfWeek: localParts.dayOfWeek,
      },
    },
  });

  if (!workingHours) {
    throw new AppError('SLOT_NOT_AVAILABLE', 422, 'Master does not work on the selected day');
  }

  const workStartUtc = localDateTimeToUtc(localDate, workingHours.startTime, company.timezone);
  const workEndUtc = localDateTimeToUtc(localDate, workingHours.endTime, company.timezone);
  const durationMs = service.durationMin * 60_000;
  const stepMs = company.slotIntervalMin * 60_000;
  const endAt = addDurationMsUtc(startAt, durationMs);

  if (startAt.getTime() < workStartUtc.getTime() || endAt.getTime() > workEndUtc.getTime()) {
    throw new AppError(
      'SLOT_NOT_AVAILABLE',
      422,
      'Selected time is outside the master working hours',
    );
  }

  if ((startAt.getTime() - workStartUtc.getTime()) % stepMs !== 0) {
    throw new AppError('SLOT_NOT_AVAILABLE', 422, 'Selected time does not lie on the slot grid');
  }

  if (workingHours.breakStart && workingHours.breakEnd) {
    const breakStartUtc = localDateTimeToUtc(localDate, workingHours.breakStart, company.timezone);
    const breakEndUtc = localDateTimeToUtc(localDate, workingHours.breakEnd, company.timezone);
    if (breakStartUtc.getTime() < endAt.getTime() && breakEndUtc.getTime() > startAt.getTime()) {
      throw new AppError(
        'SLOT_NOT_AVAILABLE',
        422,
        'Selected time overlaps the master break window',
      );
    }
  }

  const overlappingTimeOff = await db.timeOff.findFirst({
    where: {
      companyId: company.id,
      userId: master.id,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (overlappingTimeOff) {
    throw new AppError('SLOT_NOT_AVAILABLE', 422, 'Master is unavailable due to time off');
  }

  return { localDate, endAt };
}

export async function getStaffAvailabilityForActor(
  actor: AuthenticatedActor,
  query: GetAvailabilityQuery,
): Promise<AvailabilityResultDto> {
  // Phase 5 Task 1: MASTER only for self (another master's ID returns 404 per BR-5)
  if (actor.role === Role.MASTER && query.masterId !== actor.userId) {
    throw new AppError('NOT_FOUND', 404, 'Master not found');
  }

  const [company, master] = await Promise.all([
    prisma.company.findUnique({
      where: { id: actor.companyId },
    }),
    prisma.user.findFirst({
      where: { id: query.masterId, companyId: actor.companyId },
    }),
  ]);

  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }
  if (!master) {
    throw new AppError('NOT_FOUND', 404, 'Master not found');
  }

  if (!master.isActive || !master.isBookable) {
    throw new AppError('VALIDATION_ERROR', 400, 'Selected master is not active or not bookable', [
      { path: 'masterId', message: 'Selected master is not active or not bookable' },
    ]);
  }

  const selection = await resolveServiceSelection(
    prisma,
    actor.companyId,
    query.serviceId,
    query.serviceIds,
    master.id,
    query.packageId,
  );
  return computeAvailableSlotsForDate(prisma, {
    company,
    service: selection.service,
    master,
    date: query.date,
  });
}
