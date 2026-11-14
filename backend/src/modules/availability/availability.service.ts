import {
  AppointmentStatus,
  Role,
  type Company,
  type Service,
  type User,
} from '../../generated/prisma/client.js';
import {
  addDaysToLocalDate,
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

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.COMPLETED,
];

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
  const now = params.now ?? new Date();

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

  // 4. Load the master's blocking appointments overlapping that window
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

  // 5 & 6. Generate candidate starts and drop those overlapping a blocking appointment or < now + minLeadTimeMin
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

    const candidateDate = new Date(candidateStartMs);
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
  const now = params.now ?? new Date();

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
  const endAt = new Date(startAt.getTime() + durationMs);

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

  const [company, master, service] = await Promise.all([
    prisma.company.findUnique({
      where: { id: actor.companyId },
    }),
    prisma.user.findFirst({
      where: { id: query.masterId, companyId: actor.companyId },
    }),
    prisma.service.findFirst({
      where: { id: query.serviceId, companyId: actor.companyId },
    }),
  ]);

  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }
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

  return computeAvailableSlotsForDate(prisma, {
    company,
    service,
    master,
    date: query.date,
  });
}
