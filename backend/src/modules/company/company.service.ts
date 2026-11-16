import {
  AuditActor,
  Prisma,
  type BusinessType,
  type Company,
} from '../../generated/prisma/client.js';
import { audit, type AuditRequestContext } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { normalizePhoneE164 } from '../../lib/phone.js';
import { prisma, prismaUnfiltered } from '../../lib/prisma.js';
import type { UpdateCompanyBody } from './company.schemas.js';

export interface CompanyDto {
  id: string;
  name: string;
  slug: string;
  businessType: BusinessType;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  slotIntervalMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  publicBookingEnabled: boolean;
  clientCancelMinHours: number;
  allowClientReschedule: boolean;
  createdAt: string;
  updatedAt: string;
}

export function serializeCompany(company: Company): CompanyDto {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    businessType: company.businessType,
    phone: company.phone,
    address: company.address,
    timezone: company.timezone,
    currency: company.currency,
    slotIntervalMin: company.slotIntervalMin,
    minLeadTimeMin: company.minLeadTimeMin,
    maxAdvanceDays: company.maxAdvanceDays,
    publicBookingEnabled: company.publicBookingEnabled,
    clientCancelMinHours: company.clientCancelMinHours,
    allowClientReschedule: company.allowClientReschedule,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

export async function getCompanyById(companyId: string): Promise<CompanyDto> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }
  return serializeCompany(company);
}

export async function updateCompanyById(
  companyId: string,
  input: UpdateCompanyBody,
  auditMeta?: { actorId?: string; context?: AuditRequestContext },
): Promise<CompanyDto> {
  const existing = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  let normalizedPhone: string | null | undefined;
  if (input.phone !== undefined) {
    if (input.phone === null || input.phone.length === 0) {
      normalizedPhone = null;
    } else {
      normalizedPhone = normalizePhoneE164(input.phone, 'phone');
    }
  }

  let normalizedAddress: string | null | undefined;
  if (input.address !== undefined) {
    normalizedAddress = input.address === null || input.address.length === 0 ? null : input.address;
  }

  if (input.slug !== undefined && input.slug !== existing.slug) {
    const slugCollision = await prismaUnfiltered.company.findUnique({
      where: { slug: input.slug },
    });
    if (slugCollision && slugCollision.id !== companyId) {
      throw new AppError('CONFLICT', 409, 'Company slug is already taken');
    }
  }

  const updateData: Prisma.CompanyUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.businessType !== undefined ? { businessType: input.businessType } : {}),
    ...(normalizedPhone !== undefined ? { phone: normalizedPhone } : {}),
    ...(normalizedAddress !== undefined ? { address: normalizedAddress } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.slotIntervalMin !== undefined ? { slotIntervalMin: input.slotIntervalMin } : {}),
    ...(input.minLeadTimeMin !== undefined ? { minLeadTimeMin: input.minLeadTimeMin } : {}),
    ...(input.maxAdvanceDays !== undefined ? { maxAdvanceDays: input.maxAdvanceDays } : {}),
    ...(input.publicBookingEnabled !== undefined
      ? { publicBookingEnabled: input.publicBookingEnabled }
      : {}),
  };

  try {
    const updated = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });
    await audit(prisma, {
      actorType: AuditActor.USER,
      actorId: auditMeta?.actorId ?? null,
      companyId,
      action: 'company.update',
      entityType: 'Company',
      entityId: companyId,
      metadata: {
        updatedFields: Object.keys(updateData),
      },
      context: auditMeta?.context,
    });
    return serializeCompany(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError('CONFLICT', 409, 'Company slug is already taken');
    }
    throw err;
  }
}
