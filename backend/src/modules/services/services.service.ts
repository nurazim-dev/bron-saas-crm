import { AppointmentStatus, Prisma, Role, type Service } from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateServiceBody, UpdateServiceBody } from './services.schemas.js';

export interface ServiceDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function serializeService(service: Service): ServiceDto {
  return {
    id: service.id,
    companyId: service.companyId,
    name: service.name,
    description: service.description,
    durationMin: service.durationMin,
    price: service.price.toFixed(2),
    isActive: service.isActive,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

export async function listServicesForCompany(
  companyId: string,
  callerRole: Role,
): Promise<ServiceDto[]> {
  const services = await prisma.service.findMany({
    where: {
      companyId,
      ...(callerRole === Role.MASTER ? { isActive: true } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
  });
  return services.map(serializeService);
}

export async function getServiceByIdForCompany(
  companyId: string,
  serviceId: string,
  callerRole: Role,
): Promise<ServiceDto> {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      companyId,
      ...(callerRole === Role.MASTER ? { isActive: true } : {}),
    },
  });
  if (!service) {
    throw new AppError('NOT_FOUND', 404, 'Service not found');
  }
  return serializeService(service);
}

export async function createServiceForCompany(
  companyId: string,
  input: CreateServiceBody,
): Promise<ServiceDto> {
  const description =
    input.description === undefined || input.description === null || input.description.length === 0
      ? null
      : input.description;

  const created = await prisma.service.create({
    data: {
      companyId,
      name: input.name,
      description,
      durationMin: input.durationMin,
      price: new Prisma.Decimal(input.price),
      isActive: input.isActive,
    },
  });
  return serializeService(created);
}

export async function updateServiceForCompany(
  companyId: string,
  serviceId: string,
  input: UpdateServiceBody,
): Promise<ServiceDto> {
  const existing = await prisma.service.findFirst({
    where: { id: serviceId, companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Service not found');
  }

  let normalizedDescription: string | null | undefined;
  if (input.description !== undefined) {
    normalizedDescription =
      input.description === null || input.description.length === 0 ? null : input.description;
  }

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(normalizedDescription !== undefined ? { description: normalizedDescription } : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
      ...(input.price !== undefined ? { price: new Prisma.Decimal(input.price) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return serializeService(updated);
}

export async function deleteServiceForCompany(companyId: string, serviceId: string): Promise<void> {
  const existing = await prisma.service.findFirst({
    where: { id: serviceId, companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Service not found');
  }

  const now = clockNow();
  const upcomingCount = await prisma.appointment.count({
    where: {
      companyId,
      serviceId,
      status: AppointmentStatus.SCHEDULED,
      startAt: { gte: now },
    },
  });

  if (upcomingCount > 0) {
    throw new AppError(
      'HAS_UPCOMING_APPOINTMENTS',
      409,
      `Cannot delete service with ${upcomingCount} upcoming scheduled appointment(s)`,
      [
        {
          message: `Service has ${upcomingCount} upcoming scheduled appointment(s)`,
          upcomingAppointmentsCount: upcomingCount,
        },
      ],
    );
  }

  await prisma.masterService.deleteMany({ where: { serviceId } });
  await prisma.service.delete({ where: { id: serviceId } });
}
