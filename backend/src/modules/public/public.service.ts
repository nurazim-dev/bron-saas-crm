import { randomBytes, randomUUID } from 'node:crypto';
import {
  AppointmentSource,
  AppointmentStatus,
  PrepaymentStatus,
  Role,
  type BusinessType,
  type Company,
  type Service,
  type User,
} from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { now as clockNow } from '../../lib/clock.js';
import {
  addDurationMsUtc,
  addMinutesUtc,
  getLocalDayBoundsUtc,
  utcToLocalParts,
} from '../../lib/datetime.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isExclusionConstraintError } from '../../middleware/error-handler.js';
import {
  assertNoSlotOverlap,
  lockMastersForUpdate,
  type TransactionClient,
} from '../appointments/appointments.service.js';
import {
  buildPublicPrepaymentBlock,
  computePrepaymentAmount,
  type PublicPrepaymentBlock,
} from '../appointments/prepayment.js';
import { upsertClientInTx } from '../clients/clients.service.js';
import { enqueue } from '../notifications/outbox.service.js';
import { scheduleAppointmentReminders } from '../notifications/reminders.service.js';
import { notifyCompanyStaff } from '../notifications/staff-notify.service.js';
import {
  assertPublicSlotValidForSchedule,
  computeAvailableSlotsForDate,
  type AvailabilityResultDto,
  type AvailableSlotDto,
  type DbClient,
} from '../availability/availability.service.js';
import { isCompanyBookingLocked } from '../billing/billing.service.js';
import type { CreatePublicAppointmentBody, GetPublicAvailabilityQuery } from './public.schemas.js';

const MAX_UPCOMING_APPOINTMENTS_PER_PHONE = 3;

export interface PublicCompanySummaryDto {
  name: string;
  slug: string;
  businessType: BusinessType;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  bookingEnabled: boolean;
  maxAdvanceDays: number;
}

export interface PublicServiceDto {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
  requiresPrepayment: boolean;
  prepaymentAmount: string | null;
}

export interface PublicMasterDto {
  id: string;
  name: string;
  serviceIds: string[];
}

export interface PublicCompanyProfileDto {
  company: PublicCompanySummaryDto;
  services: PublicServiceDto[];
  masters: PublicMasterDto[];
}

export interface PublicBookedAppointmentDto {
  id: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  service: {
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
    address: string | null;
    phone: string | null;
    timezone: string;
  };
}

export interface PublicCreateAppointmentResultDto {
  appointment: PublicBookedAppointmentDto;
  manageUrl: string;
  prepayment: PublicPrepaymentBlock | null;
}

function isAnyMasterChoice(
  masterId: string | null | undefined,
): masterId is undefined | null | 'ANY' {
  return masterId === undefined || masterId === null || masterId === 'ANY';
}

async function resolveEnabledCompanyBySlug(db: DbClient, slug: string): Promise<Company> {
  const company = await db.company.findUnique({
    where: { slug: slug.toLowerCase() },
  });

  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  if (
    !company.publicBookingEnabled ||
    company.suspendedAt !== null ||
    (await isCompanyBookingLocked(company.id, db))
  ) {
    throw new AppError(
      'BOOKING_DISABLED',
      403,
      'Online booking is currently disabled for this company',
    );
  }

  return company;
}

async function resolveActiveService(
  db: DbClient,
  companyId: string,
  serviceId: string,
): Promise<Service> {
  const service = await db.service.findFirst({
    where: { id: serviceId, companyId },
  });

  if (!service) {
    throw new AppError('NOT_FOUND', 404, 'Service not found');
  }

  if (!service.isActive) {
    throw new AppError('VALIDATION_ERROR', 400, 'Selected service is not active', [
      { path: 'serviceId', message: 'Selected service is not active' },
    ]);
  }

  return service;
}

async function resolveCandidateMastersForService(
  db: DbClient,
  companyId: string,
  serviceId: string,
): Promise<User[]> {
  return db.user.findMany({
    where: {
      companyId,
      isActive: true,
      isBookable: true,
      services: {
        some: {
          serviceId,
        },
      },
      workingHours: {
        some: {},
      },
    },
    orderBy: {
      id: 'asc',
    },
  });
}

async function resolveBookableMasterAndService(
  db: DbClient,
  companyId: string,
  masterId: string,
  serviceId: string,
): Promise<{ master: User; service: Service }> {
  const [master, service] = await Promise.all([
    db.user.findFirst({
      where: { id: masterId, companyId },
    }),
    db.service.findFirst({
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

  const link = await db.masterService.findUnique({
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

export async function getPublicCompanyProfileBySlug(
  slug: string,
): Promise<PublicCompanyProfileDto> {
  const company = await resolveEnabledCompanyBySlug(prisma, slug);

  const [activeServices, candidateUsers, sub] = await Promise.all([
    prisma.service.findMany({
      where: {
        companyId: company.id,
        isActive: true,
      },
      orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
    }),
    prisma.user.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        isBookable: true,
      },
      include: {
        services: {
          include: {
            service: {
              select: {
                id: true,
                isActive: true,
                deletedAt: true,
              },
            },
          },
        },
        workingHours: {
          select: { id: true },
        },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.subscription.findUnique({
      where: { companyId: company.id },
      include: { plan: { select: { featurePrepayment: true } } },
    }),
  ]);
  const planHasPrepayment = sub?.plan.featurePrepayment ?? false;

  const activeServiceIdSet = new Set(activeServices.map((s) => s.id));

  // Only entities that are actually bookable: master has >= 1 active service and >= 1 working-hours row
  const bookableMasters: PublicMasterDto[] = [];
  for (const user of candidateUsers) {
    if (user.workingHours.length === 0) {
      continue;
    }
    const assignedActiveServiceIds = user.services
      .filter(
        (ms) =>
          ms.service.deletedAt === null &&
          ms.service.isActive &&
          activeServiceIdSet.has(ms.serviceId),
      )
      .map((ms) => ms.serviceId);

    if (assignedActiveServiceIds.length === 0) {
      continue;
    }

    bookableMasters.push({
      id: user.id,
      name: user.name,
      serviceIds: assignedActiveServiceIds,
    });
  }

  return {
    company: {
      name: company.name,
      slug: company.slug,
      businessType: company.businessType,
      phone: company.phone,
      address: company.address,
      timezone: company.timezone,
      currency: company.currency,
      bookingEnabled: company.publicBookingEnabled,
      maxAdvanceDays: company.maxAdvanceDays,
    },
    services: activeServices.map((s) => {
      const hasPrep =
        planHasPrepayment &&
        s.requiresPrepayment &&
        s.prepaymentMode !== null &&
        s.prepaymentValue !== null;
      const prepAmount =
        hasPrep && s.prepaymentMode && s.prepaymentValue
          ? computePrepaymentAmount(s.price, s.prepaymentMode, s.prepaymentValue).toFixed(2)
          : null;
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        durationMin: s.durationMin,
        price: s.price.toFixed(2),
        requiresPrepayment: hasPrep,
        prepaymentAmount: prepAmount,
      };
    }),
    masters: bookableMasters,
  };
}

export async function getPublicAvailabilityBySlug(
  slug: string,
  query: GetPublicAvailabilityQuery,
): Promise<AvailabilityResultDto> {
  const company = await resolveEnabledCompanyBySlug(prisma, slug);

  if (isAnyMasterChoice(query.masterId)) {
    const service = await resolveActiveService(prisma, company.id, query.serviceId);
    const candidates = await resolveCandidateMastersForService(prisma, company.id, service.id);

    if (candidates.length === 0) {
      return {
        date: query.date,
        timezone: company.timezone,
        slots: [],
      };
    }

    const currentNow = clockNow();
    const perMasterResults = await Promise.all(
      candidates.map((master) =>
        computeAvailableSlotsForDate(prisma, {
          company,
          service,
          master,
          date: query.date,
          now: currentNow,
        }),
      ),
    );

    const slotByStartAt = new Map<string, AvailableSlotDto>();
    for (const res of perMasterResults) {
      for (const slot of res.slots) {
        if (!slotByStartAt.has(slot.startAt)) {
          slotByStartAt.set(slot.startAt, slot);
        }
      }
    }

    const mergedSlots = Array.from(slotByStartAt.values()).sort((a, b) =>
      a.startAt.localeCompare(b.startAt),
    );

    return {
      date: query.date,
      timezone: company.timezone,
      slots: mergedSlots,
    };
  }

  const { master, service } = await resolveBookableMasterAndService(
    prisma,
    company.id,
    query.masterId,
    query.serviceId,
  );

  return computeAvailableSlotsForDate(prisma, {
    company,
    service,
    master,
    date: query.date,
  });
}

async function bookSingleMasterInTransaction(
  slug: string,
  masterId: string,
  input: CreatePublicAppointmentBody,
  clientNote: string | null,
): Promise<PublicCreateAppointmentResultDto> {
  try {
    return await prisma.$transaction(async (tx: TransactionClient) => {
      // BR-12: Lock strictly ONE master at a time inside the transaction
      await lockMastersForUpdate(tx, [masterId]);

      const company = await resolveEnabledCompanyBySlug(tx, slug);
      const { master, service } = await resolveBookableMasterAndService(
        tx,
        company.id,
        masterId,
        input.serviceId,
      );

      const currentNow = clockNow();

      // 1. Validate schedule, grid, lead time, and max advance (422 SLOT_NOT_AVAILABLE on violation)
      const { localDate, endAt } = await assertPublicSlotValidForSchedule(tx, {
        company,
        service,
        master,
        startAt: input.startAt,
        now: currentNow,
      });

      // 2. Check BR-1 overlap (409 SLOT_ALREADY_BOOKED on conflict)
      await assertNoSlotOverlap(tx, {
        companyId: company.id,
        masterId: master.id,
        startAt: input.startAt,
        endAt,
      });

      // 3. Authoritative BR-4 re-validation inside the transaction
      const availability = await computeAvailableSlotsForDate(tx, {
        company,
        service,
        master,
        date: localDate,
        now: currentNow,
      });
      const targetIso = input.startAt.toISOString();
      if (!availability.slots.some((slot) => slot.startAt === targetIso)) {
        throw new AppError(
          'SLOT_NOT_AVAILABLE',
          422,
          'Selected time slot is not available for booking',
        );
      }

      // 4. BR-3 per-phone limit: at most 3 upcoming SCHEDULED appointments per phone per company
      const upcomingForPhone = await tx.appointment.count({
        where: {
          companyId: company.id,
          clientPhone: input.clientPhone,
          status: AppointmentStatus.SCHEDULED,
          startAt: { gte: currentNow },
        },
      });

      if (upcomingForPhone >= MAX_UPCOMING_APPOINTMENTS_PER_PHONE) {
        throw new AppError(
          'CONFLICT',
          409,
          `Maximum of ${String(MAX_UPCOMING_APPOINTMENTS_PER_PHONE)} upcoming scheduled appointments per phone number reached`,
        );
      }

      const client = await upsertClientInTx(tx, {
        companyId: company.id,
        name: input.clientName,
        phone: input.clientPhone,
        overwriteName: false,
        currentTime: currentNow,
        locale: input.locale ?? company.defaultLocale,
      });

      if (client.isBlocked) {
        throw new AppError(
          'BOOKING_NOT_ALLOWED',
          403,
          'Online booking is not available for this phone number. Please contact the business.',
        );
      }

      const sub = await tx.subscription.findUnique({
        where: { companyId: company.id },
        include: { plan: { select: { featurePrepayment: true } } },
      });
      const prepayEnabled =
        (sub?.plan.featurePrepayment ?? false) &&
        service.requiresPrepayment &&
        service.prepaymentMode !== null &&
        service.prepaymentValue !== null;

      const prepaymentAmount =
        prepayEnabled && service.prepaymentMode && service.prepaymentValue
          ? computePrepaymentAmount(service.price, service.prepaymentMode, service.prepaymentValue)
          : null;
      const prepaymentStatus = prepayEnabled
        ? PrepaymentStatus.PENDING
        : PrepaymentStatus.NOT_REQUIRED;
      const prepaymentHoldUntil =
        prepayEnabled && company.prepaymentHoldMin > 0
          ? addDurationMsUtc(currentNow, company.prepaymentHoldMin * 60_000)
          : null;

      const manageToken = randomBytes(32).toString('base64url');
      const created = await tx.appointment.create({
        data: {
          companyId: company.id,
          masterId: master.id,
          serviceId: service.id,
          clientId: client.id,
          clientName: input.clientName,
          clientPhone: input.clientPhone,
          clientNote,
          internalNote: null,
          startAt: input.startAt,
          endAt,
          price: service.price,
          status: AppointmentStatus.SCHEDULED,
          source: AppointmentSource.ONLINE,
          manageToken,
          clientLocale: input.locale ?? company.defaultLocale,
          consentAcceptedAt: currentNow,
          prepaymentStatus,
          prepaymentAmount,
          prepaymentHoldUntil,
        },
      });

      if (prepaymentStatus === PrepaymentStatus.PENDING && prepaymentAmount) {
        const owner = await tx.user.findFirst({
          where: {
            companyId: company.id,
            role: Role.OWNER,
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, email: true, notifyEmail: true },
        });
        if (owner) {
          const local = utcToLocalParts(created.startAt, company.timezone);
          const amountStr = prepaymentAmount.toFixed(2);
          await tx.inAppNotification.create({
            data: {
              companyId: company.id,
              userId: owner.id,
              kind: 'PREPAYMENT_PENDING_OWNER',
              title: `Ожидается предоплата: ${created.clientName}`,
              body: `${service.name} • ${amountStr} ${company.currency} • ${local.date} ${local.time}`,
              data: { appointmentId: created.id },
            },
          });
          if (owner.notifyEmail && owner.email) {
            await enqueue(tx, {
              companyId: company.id,
              channel: 'EMAIL',
              kind: 'PREPAYMENT_PENDING_OWNER',
              recipient: owner.email,
              toUserId: owner.id,
              appointmentId: created.id,
              payload: {
                clientName: created.clientName,
                serviceName: service.name,
                amount: amountStr,
                localDateTime: `${local.date} ${local.time}`,
              },
              dedupeKey: `prepay-pending:${created.id}:${owner.id}`,
            });
          }
        }
      }

      await notifyCompanyStaff(tx, {
        kind: 'NEW_ONLINE_BOOKING',
        companyId: company.id,
        companyName: company.name,
        timezone: company.timezone,
        appointmentId: created.id,
        masterId: master.id,
        masterName: master.name,
        serviceName: service.name,
        clientName: created.clientName,
        startAt: created.startAt,
        dedupeSuffix: 'online',
      });

      await scheduleAppointmentReminders(tx, {
        appointment: created,
        company,
        serviceName: service.name,
        currentNow,
      });

      return {
        manageUrl: `${env.APP_URL}/manage/${created.manageToken}`,
        prepayment: buildPublicPrepaymentBlock(created, company, service.name),
        appointment: {
          id: created.id,
          startAt: created.startAt.toISOString(),
          endAt: created.endAt.toISOString(),
          status: created.status,
          service: {
            name: service.name,
            durationMin: service.durationMin,
            price: created.price.toFixed(2),
          },
          master: {
            id: master.id,
            name: master.name,
          },
          company: {
            name: company.name,
            address: company.address,
            phone: company.phone,
            timezone: company.timezone,
          },
        },
      };
    });
  } catch (err) {
    if (isExclusionConstraintError(err)) {
      throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Selected time slot is already booked');
    }
    throw err;
  }
}

export async function createPublicAppointmentBySlug(
  slug: string,
  input: CreatePublicAppointmentBody,
): Promise<PublicCreateAppointmentResultDto> {
  const preflightCompany = await resolveEnabledCompanyBySlug(prisma, slug);

  const clientNote =
    input.clientNote === undefined || input.clientNote === null || input.clientNote.length === 0
      ? null
      : input.clientNote;

  if (!isAnyMasterChoice(input.masterId)) {
    const preflightEntities = await resolveBookableMasterAndService(
      prisma,
      preflightCompany.id,
      input.masterId,
      input.serviceId,
    );

    // Honeypot `website`: if filled, return a fake 201 and write nothing to the DB
    if (input.website.trim().length > 0) {
      const fakeEndAt = addMinutesUtc(input.startAt, preflightEntities.service.durationMin);
      return {
        manageUrl: `${env.APP_URL}/manage/${randomBytes(32).toString('base64url')}`,
        prepayment: null,
        appointment: {
          id: randomUUID(),
          startAt: input.startAt.toISOString(),
          endAt: fakeEndAt.toISOString(),
          status: AppointmentStatus.SCHEDULED,
          service: {
            name: preflightEntities.service.name,
            durationMin: preflightEntities.service.durationMin,
            price: preflightEntities.service.price.toFixed(2),
          },
          master: {
            id: preflightEntities.master.id,
            name: preflightEntities.master.name,
          },
          company: {
            name: preflightCompany.name,
            address: preflightCompany.address,
            phone: preflightCompany.phone,
            timezone: preflightCompany.timezone,
          },
        },
      };
    }

    return bookSingleMasterInTransaction(slug, input.masterId, input, clientNote);
  }

  // BR-12: Any-available-master booking
  const preflightService = await resolveActiveService(prisma, preflightCompany.id, input.serviceId);
  const candidates = await resolveCandidateMastersForService(
    prisma,
    preflightCompany.id,
    preflightService.id,
  );

  if (candidates.length === 0) {
    throw new AppError(
      'SLOT_NOT_AVAILABLE',
      422,
      'Selected time slot is not available for booking',
    );
  }

  const firstCandidate = candidates[0];
  if (input.website.trim().length > 0 && firstCandidate) {
    const fakeEndAt = addMinutesUtc(input.startAt, preflightService.durationMin);
    return {
      manageUrl: `${env.APP_URL}/manage/${randomBytes(32).toString('base64url')}`,
      prepayment: null,
      appointment: {
        id: randomUUID(),
        startAt: input.startAt.toISOString(),
        endAt: fakeEndAt.toISOString(),
        status: AppointmentStatus.SCHEDULED,
        service: {
          name: preflightService.name,
          durationMin: preflightService.durationMin,
          price: preflightService.price.toFixed(2),
        },
        master: {
          id: firstCandidate.id,
          name: firstCandidate.name,
        },
        company: {
          name: preflightCompany.name,
          address: preflightCompany.address,
          phone: preflightCompany.phone,
          timezone: preflightCompany.timezone,
        },
      },
    };
  }

  // Deterministic candidate ordering: fewest appointments on that local day ASC, then id ASC
  const localDate = utcToLocalParts(input.startAt, preflightCompany.timezone).date;
  const { startUtc: dayStartUtc, endUtc: dayEndUtc } = getLocalDayBoundsUtc(
    localDate,
    preflightCompany.timezone,
  );
  const candidateIds = candidates.map((c) => c.id);

  const dayCounts = await prisma.appointment.groupBy({
    by: ['masterId'],
    where: {
      companyId: preflightCompany.id,
      masterId: { in: candidateIds },
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED] },
      startAt: { lt: dayEndUtc },
      endAt: { gt: dayStartUtc },
    },
    _count: {
      _all: true,
    },
  });

  const countByMasterId = new Map<string, number>();
  for (const row of dayCounts) {
    countByMasterId.set(row.masterId, row._count._all);
  }

  const orderedCandidates = [...candidates].sort((a, b) => {
    const countA = countByMasterId.get(a.id) ?? 0;
    const countB = countByMasterId.get(b.id) ?? 0;
    if (countA !== countB) {
      return countA - countB;
    }
    return a.id.localeCompare(b.id);
  });

  let sawSlotAlreadyBooked = false;

  for (const candidate of orderedCandidates) {
    try {
      return await bookSingleMasterInTransaction(slug, candidate.id, input, clientNote);
    } catch (err) {
      if (err instanceof AppError) {
        if (err.code === 'SLOT_ALREADY_BOOKED') {
          sawSlotAlreadyBooked = true;
          continue;
        }
        if (
          err.code === 'SLOT_NOT_AVAILABLE' ||
          err.code === 'NOT_FOUND' ||
          err.code === 'VALIDATION_ERROR'
        ) {
          continue;
        }
      }
      throw err;
    }
  }

  if (sawSlotAlreadyBooked) {
    throw new AppError('SLOT_ALREADY_BOOKED', 409, 'Selected time slot is already booked');
  }

  throw new AppError('SLOT_NOT_AVAILABLE', 422, 'Selected time slot is not available for booking');
}
