import {
  AppointmentStatus,
  AuditActor,
  type PrepaymentMode,
  Prisma,
  Role,
  type Service,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertPlanFeature } from '../billing/billing.service.js';
import type { CreateServiceBody, UpdateServiceBody } from './services.schemas.js';

export interface ServiceDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
  requiresPrepayment: boolean;
  prepaymentMode: PrepaymentMode | null;
  prepaymentValue: string | null;
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
    requiresPrepayment: service.requiresPrepayment,
    prepaymentMode: service.prepaymentMode,
    prepaymentValue: service.prepaymentValue ? service.prepaymentValue.toFixed(2) : null,
    isActive: service.isActive,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

async function resolveServicePrepaymentConfig(
  companyId: string,
  requiresPrepayment: boolean,
  mode: PrepaymentMode | null | undefined,
  value: string | null | undefined,
): Promise<{
  requiresPrepayment: boolean;
  prepaymentMode: PrepaymentMode | null;
  prepaymentValue: Prisma.Decimal | null;
}> {
  if (!requiresPrepayment) {
    return {
      requiresPrepayment: false,
      prepaymentMode: null,
      prepaymentValue: null,
    };
  }

  await assertPlanFeature(companyId, 'prepayment');

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { paymentInstructions: true },
  });
  if (!company?.paymentInstructions || company.paymentInstructions.trim().length === 0) {
    throw new AppError(
      'PAYMENT_INSTRUCTIONS_REQUIRED',
      409,
      'Payment instructions must be configured before enabling prepayment',
    );
  }

  if (!mode || !value) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'prepaymentMode and prepaymentValue are required when requiresPrepayment is true',
    );
  }

  const numVal = Number(value);
  if (!Number.isFinite(numVal) || numVal <= 0 || (mode === 'PERCENT' && numVal > 100)) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      mode === 'PERCENT'
        ? 'Percent prepayment value must be between 1 and 100'
        : 'Fixed prepayment value must be greater than 0',
    );
  }

  return {
    requiresPrepayment: true,
    prepaymentMode: mode,
    prepaymentValue: new Prisma.Decimal(value),
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

  const prepay = await resolveServicePrepaymentConfig(
    companyId,
    input.requiresPrepayment,
    input.prepaymentMode,
    input.prepaymentValue,
  );

  const created = await prisma.service.create({
    data: {
      companyId,
      name: input.name,
      description,
      durationMin: input.durationMin,
      price: new Prisma.Decimal(input.price),
      requiresPrepayment: prepay.requiresPrepayment,
      prepaymentMode: prepay.prepaymentMode,
      prepaymentValue: prepay.prepaymentValue,
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

  const nextRequiresPrepayment = input.requiresPrepayment ?? existing.requiresPrepayment;
  const nextMode =
    input.prepaymentMode !== undefined ? input.prepaymentMode : existing.prepaymentMode;
  const nextValue =
    input.prepaymentValue !== undefined
      ? input.prepaymentValue
      : existing.prepaymentValue
        ? existing.prepaymentValue.toFixed(2)
        : null;

  const prepay =
    input.requiresPrepayment !== undefined ||
    input.prepaymentMode !== undefined ||
    input.prepaymentValue !== undefined
      ? await resolveServicePrepaymentConfig(companyId, nextRequiresPrepayment, nextMode, nextValue)
      : undefined;

  const updated = await prisma.service.update({
    where: { id: serviceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(normalizedDescription !== undefined ? { description: normalizedDescription } : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
      ...(input.price !== undefined ? { price: new Prisma.Decimal(input.price) } : {}),
      ...(prepay
        ? {
            requiresPrepayment: prepay.requiresPrepayment,
            prepaymentMode: prepay.prepaymentMode,
            prepaymentValue: prepay.prepaymentValue,
          }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return serializeService(updated);
}

export async function deleteServiceForCompany(
  companyId: string,
  serviceId: string,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<void> {
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
  await audit(prisma, {
    actorType: AuditActor.USER,
    actorId: auditMeta?.actorId ?? null,
    companyId,
    action: 'service.delete',
    entityType: 'Service',
    entityId: serviceId,
    metadata: { name: existing.name },
    context: auditMeta?.context,
  });
}
