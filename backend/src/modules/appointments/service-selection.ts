import { z } from 'zod';
import { Prisma, type Service } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { DbClient } from '../availability/availability.service.js';
import { computePrepaymentAmount } from './prepayment.js';

export const serviceIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate services');

export const serviceIdsQuerySchema = z
  .string()
  .transform((value) => value.split(','))
  .pipe(serviceIdsSchema);

export function selectionIds(primary: string, ids?: string[]): string[] {
  if (ids && ids[0] !== primary) {
    throw new AppError('VALIDATION_ERROR', 400, 'serviceId must be the first selected service');
  }
  return ids ?? [primary];
}

export interface ServiceSelectionResult {
  service: Service;
  services: Service[];
  packageRef: { id: string; name: string } | null;
}

export async function resolveServiceSelection(
  db: DbClient,
  companyId: string,
  primary: string | undefined,
  ids?: string[],
  masterId?: string,
  packageId?: string,
): Promise<ServiceSelectionResult> {
  let selected: string[];
  let packageRef: { id: string; name: string; price: Prisma.Decimal } | null = null;

  if (packageId) {
    const pkg = await db.servicePackage.findFirst({
      where: { id: packageId, companyId, deletedAt: null },
      include: {
        items: { orderBy: { position: 'asc' } },
      },
    });
    if (!pkg) {
      throw new AppError('NOT_FOUND', 404, 'Service package not found');
    }
    if (!pkg.isActive) {
      throw new AppError('VALIDATION_ERROR', 400, 'Selected service package is not active');
    }
    if (pkg.items.length < 2) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'Service package must contain at least 2 services',
      );
    }
    selected = pkg.items.map((item) => item.serviceId);
    packageRef = { id: pkg.id, name: pkg.name, price: pkg.price };
  } else {
    if (!primary) {
      throw new AppError('VALIDATION_ERROR', 400, 'Either serviceId or packageId is required');
    }
    selected = selectionIds(primary, ids);
  }

  const rows = await db.service.findMany({
    where: { companyId, id: { in: selected }, deletedAt: null },
  });

  const baseServices = selected.map((id) => {
    const service = rows.find((row) => row.id === id);
    if (!service) {
      if (packageRef) {
        throw new AppError(
          'VALIDATION_ERROR',
          400,
          'One or more services in this package are no longer available',
        );
      }
      throw new AppError('NOT_FOUND', 404, 'Service not found');
    }
    if (!service.isActive) {
      throw new AppError('VALIDATION_ERROR', 400, 'Selected service is not active');
    }
    return service;
  });

  let effectiveServices = baseServices;

  if (masterId) {
    const masterLinks = await db.masterService.findMany({
      where: {
        userId: masterId,
        serviceId: { in: selected },
        user: { companyId },
        service: { companyId },
      },
    });
    if (masterLinks.length !== selected.length) {
      throw new AppError('VALIDATION_ERROR', 400, 'Master must provide every selected service');
    }
    const linkByServiceId = new Map(masterLinks.map((link) => [link.serviceId, link]));
    effectiveServices = baseServices.map((service) => {
      const link = linkByServiceId.get(service.id);
      return {
        ...service,
        durationMin: link?.customDurationMin ?? service.durationMin,
        price: link?.customPrice ?? service.price,
      };
    });
  }

  const first = effectiveServices[0];
  if (!first) {
    throw new AppError('VALIDATION_ERROR', 400, 'Select at least one service');
  }

  const durationMin = effectiveServices.reduce((total, service) => total + service.durationMin, 0);
  if (durationMin > 720) {
    throw new AppError('VALIDATION_ERROR', 400, 'Total duration must not exceed 720 minutes');
  }

  const sumPrice = effectiveServices.reduce(
    (total, service) => total.plus(service.price),
    new Prisma.Decimal(0),
  );
  const price = packageRef ? packageRef.price : sumPrice;
  if (price.greaterThan(1_000_000)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Total price must not exceed 1000000');
  }

  const rawPrepayment = effectiveServices.reduce(
    (total, service) =>
      total.plus(
        service.requiresPrepayment && service.prepaymentMode && service.prepaymentValue
          ? computePrepaymentAmount(service.price, service.prepaymentMode, service.prepaymentValue)
          : 0,
      ),
    new Prisma.Decimal(0),
  );
  const prepayment =
    packageRef && rawPrepayment.greaterThan(packageRef.price) ? packageRef.price : rawPrepayment;

  const aggregate: Service = {
    ...first,
    name: packageRef
      ? packageRef.name
      : effectiveServices.map((service) => service.name).join(' + '),
    durationMin,
    price,
    requiresPrepayment: prepayment.greaterThan(0),
    prepaymentMode: prepayment.greaterThan(0) ? 'FIXED' : null,
    prepaymentValue: prepayment.greaterThan(0) ? prepayment : null,
  };

  return {
    service: aggregate,
    services: effectiveServices,
    packageRef: packageRef ? { id: packageRef.id, name: packageRef.name } : null,
  };
}

export function snapshotServices(services: Service[]) {
  return services.map((service, position) => ({
    serviceId: service.id,
    position,
    name: service.name,
    durationMin: service.durationMin,
    price: service.price,
  }));
}
