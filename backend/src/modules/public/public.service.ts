import { randomUUID } from 'node:crypto';
import {
  AppointmentSource,
  AppointmentStatus,
  type BusinessType,
  type Company,
  type Service,
  type User,
} from '../../generated/prisma/client.js';
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
  type AvailabilityResultDto,
  type DbClient,
} from '../availability/availability.service.js';
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
}

async function resolveEnabledCompanyBySlug(db: DbClient, slug: string): Promise<Company> {
  const company = await db.company.findUnique({
    where: { slug: slug.toLowerCase() },
  });

  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  if (!company.publicBookingEnabled) {
    throw new AppError(
      'BOOKING_DISABLED',
      403,
      'Online booking is currently disabled for this company',
    );
  }

  return company;
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

  const [activeServices, candidateUsers] = await Promise.all([
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
  ]);

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
    services: activeServices.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      price: s.price.toFixed(2),
    })),
    masters: bookableMasters,
  };
}

export async function getPublicAvailabilityBySlug(
  slug: string,
  query: GetPublicAvailabilityQuery,
): Promise<AvailabilityResultDto> {
  const company = await resolveEnabledCompanyBySlug(prisma, slug);
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

export async function createPublicAppointmentBySlug(
  slug: string,
  input: CreatePublicAppointmentBody,
): Promise<PublicCreateAppointmentResultDto> {
  const preflightCompany = await resolveEnabledCompanyBySlug(prisma, slug);
  const preflightEntities = await resolveBookableMasterAndService(
    prisma,
    preflightCompany.id,
    input.masterId,
    input.serviceId,
  );

  // Honeypot `website`: if filled, return a fake 201 and write nothing to the DB
  if (input.website.trim().length > 0) {
    const fakeEndAt = new Date(
      input.startAt.getTime() + preflightEntities.service.durationMin * 60_000,
    );
    return {
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

  const clientNote =
    input.clientNote === undefined || input.clientNote === null || input.clientNote.length === 0
      ? null
      : input.clientNote;

  try {
    return await prisma.$transaction(async (tx: TransactionClient) => {
      await lockMastersForUpdate(tx, [input.masterId]);

      const company = await resolveEnabledCompanyBySlug(tx, slug);
      const { master, service } = await resolveBookableMasterAndService(
        tx,
        company.id,
        input.masterId,
        input.serviceId,
      );

      const now = new Date();

      // 1. Validate schedule, grid, lead time, and max advance (422 SLOT_NOT_AVAILABLE on violation)
      const { localDate, endAt } = await assertPublicSlotValidForSchedule(tx, {
        company,
        service,
        master,
        startAt: input.startAt,
        now,
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
        now,
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
          startAt: { gte: now },
        },
      });

      if (upcomingForPhone >= MAX_UPCOMING_APPOINTMENTS_PER_PHONE) {
        throw new AppError(
          'CONFLICT',
          409,
          `Maximum of ${String(MAX_UPCOMING_APPOINTMENTS_PER_PHONE)} upcoming scheduled appointments per phone number reached`,
        );
      }

      const created = await tx.appointment.create({
        data: {
          companyId: company.id,
          masterId: master.id,
          serviceId: service.id,
          clientName: input.clientName,
          clientPhone: input.clientPhone,
          clientNote,
          internalNote: null,
          startAt: input.startAt,
          endAt,
          price: service.price,
          status: AppointmentStatus.SCHEDULED,
          source: AppointmentSource.ONLINE,
        },
      });

      return {
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
