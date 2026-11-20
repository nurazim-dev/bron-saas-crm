import {
  AuditActor,
  Prisma,
  Role,
  type Service,
  type ServicePackage,
  type ServicePackageItem,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateServicePackageBody, UpdateServicePackageBody } from './services.schemas.js';

export interface ServicePackageItemDto {
  serviceId: string;
  position: number;
  name: string;
  durationMin: number;
  price: string;
  isActive: boolean;
}

export interface ServicePackageDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  price: string;
  catalogTotalPrice: string;
  totalDurationMin: number;
  isActive: boolean;
  serviceIds: string[];
  items: ServicePackageItemDto[];
  createdAt: string;
  updatedAt: string;
}

type PackageWithItems = ServicePackage & {
  items: (ServicePackageItem & {
    service: Pick<Service, 'id' | 'name' | 'durationMin' | 'price' | 'isActive' | 'deletedAt'>;
  })[];
};

const packageInclude = {
  items: {
    orderBy: { position: 'asc' as const },
    include: {
      service: {
        select: {
          id: true,
          name: true,
          durationMin: true,
          price: true,
          isActive: true,
          deletedAt: true,
        },
      },
    },
  },
} as const;

export function serializeServicePackage(pkg: PackageWithItems): ServicePackageDto {
  const validItems = pkg.items.filter((item) => item.service.deletedAt === null);
  const catalogTotal = validItems.reduce(
    (sum, item) => sum.plus(item.service.price),
    new Prisma.Decimal(0),
  );
  const totalDurationMin = validItems.reduce((sum, item) => sum + item.service.durationMin, 0);

  return {
    id: pkg.id,
    companyId: pkg.companyId,
    name: pkg.name,
    description: pkg.description,
    price: pkg.price.toFixed(2),
    catalogTotalPrice: catalogTotal.toFixed(2),
    totalDurationMin,
    isActive: pkg.isActive,
    serviceIds: validItems.map((item) => item.serviceId),
    items: validItems.map((item) => ({
      serviceId: item.serviceId,
      position: item.position,
      name: item.service.name,
      durationMin: item.service.durationMin,
      price: item.service.price.toFixed(2),
      isActive: item.service.isActive,
    })),
    createdAt: pkg.createdAt.toISOString(),
    updatedAt: pkg.updatedAt.toISOString(),
  };
}

async function assertValidPackageServices(companyId: string, serviceIds: string[]): Promise<void> {
  const matching = await prisma.service.findMany({
    where: {
      companyId,
      id: { in: serviceIds },
      deletedAt: null,
      isActive: true,
    },
    select: { id: true, durationMin: true },
  });

  if (matching.length !== serviceIds.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'All package services must belong to this company and be active',
      [
        {
          path: 'serviceIds',
          message: 'All package services must belong to this company and be active',
        },
      ],
    );
  }

  const totalDuration = matching.reduce((sum, s) => sum + s.durationMin, 0);
  if (totalDuration > 720) {
    throw new AppError(
      'VALIDATION_ERROR',
      400,
      'Total duration of services in a package must not exceed 720 minutes',
      [
        {
          path: 'serviceIds',
          message: 'Total duration of package services cannot exceed 720 minutes',
        },
      ],
    );
  }
}

export async function listServicePackagesForCompany(
  companyId: string,
  callerRole: Role,
): Promise<ServicePackageDto[]> {
  const rows = await prisma.servicePackage.findMany({
    where: {
      companyId,
      ...(callerRole === Role.MASTER ? { isActive: true } : {}),
    },
    include: packageInclude,
    orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
  });

  return rows.map(serializeServicePackage);
}

export async function createServicePackageForCompany(
  companyId: string,
  input: CreateServicePackageBody,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<ServicePackageDto> {
  await assertValidPackageServices(companyId, input.serviceIds);

  const created = await prisma.$transaction(async (tx) => {
    const pkg = await tx.servicePackage.create({
      data: {
        companyId,
        name: input.name,
        description:
          input.description === undefined || input.description === '' ? null : input.description,
        price: new Prisma.Decimal(input.price),
        isActive: input.isActive,
        items: {
          create: input.serviceIds.map((serviceId, position) => ({
            serviceId,
            position,
          })),
        },
      },
      include: packageInclude,
    });

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: auditMeta?.actorId ?? null,
      companyId,
      action: 'service_package.create',
      entityType: 'ServicePackage',
      entityId: pkg.id,
      metadata: { name: pkg.name, serviceCount: input.serviceIds.length, price: input.price },
      context: auditMeta?.context,
    });

    return pkg;
  });

  return serializeServicePackage(created);
}

export async function updateServicePackageForCompany(
  companyId: string,
  packageId: string,
  input: UpdateServicePackageBody,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<ServicePackageDto> {
  const existing = await prisma.servicePackage.findFirst({
    where: { id: packageId, companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Service package not found');
  }

  if (input.serviceIds !== undefined) {
    await assertValidPackageServices(companyId, input.serviceIds);
  }

  const nextDescription =
    input.description === undefined
      ? undefined
      : input.description === null || input.description === ''
        ? null
        : input.description;

  const updated = await prisma.$transaction(async (tx) => {
    if (input.serviceIds !== undefined) {
      await tx.servicePackageItem.deleteMany({
        where: { packageId, companyId },
      });
    }

    const pkg = await tx.servicePackage.update({
      where: { id: packageId, companyId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(nextDescription !== undefined ? { description: nextDescription } : {}),
        ...(input.price !== undefined ? { price: new Prisma.Decimal(input.price) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.serviceIds !== undefined
          ? {
              items: {
                create: input.serviceIds.map((serviceId, position) => ({
                  serviceId,
                  position,
                })),
              },
            }
          : {}),
      },
      include: packageInclude,
    });

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: auditMeta?.actorId ?? null,
      companyId,
      action: 'service_package.update',
      entityType: 'ServicePackage',
      entityId: pkg.id,
      metadata: { updatedFields: Object.keys(input) },
      context: auditMeta?.context,
    });

    return pkg;
  });

  return serializeServicePackage(updated);
}

export async function deleteServicePackageForCompany(
  companyId: string,
  packageId: string,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<void> {
  const existing = await prisma.servicePackage.findFirst({
    where: { id: packageId, companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Service package not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.servicePackage.delete({
      where: { id: packageId },
    });

    await audit(tx, {
      actorType: AuditActor.USER,
      actorId: auditMeta?.actorId ?? null,
      companyId,
      action: 'service_package.delete',
      entityType: 'ServicePackage',
      entityId: packageId,
      metadata: { name: existing.name },
      context: auditMeta?.context,
    });
  });
}
