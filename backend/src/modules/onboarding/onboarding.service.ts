import { Prisma, Role } from '../../generated/prisma/client.js';
import { now as clockNow } from '../../lib/clock.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { assertWithinStaffLimit } from '../billing/billing.service.js';
import { getPresetsForBusinessType, SERVICE_PRESETS } from './onboarding.presets.js';
import type { ApplyOnboardingBody } from './onboarding.schemas.js';

export interface OnboardingStateDto {
  businessType: string;
  companySlug: string;
  steps: {
    profileComplete: boolean;
    hasServices: boolean;
    hasBookableMaster: boolean;
    linkShared: boolean;
  };
  completedCount: number;
  totalSteps: number;
  isCompleted: boolean;
  isDismissed: boolean;
  showChecklist: boolean;
}

export async function getOnboardingState(companyId: string): Promise<OnboardingStateDto> {
  const [company, activeServicesCount, bookableMastersCount] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        slug: true,
        businessType: true,
        phone: true,
        address: true,
        onboardingLinkSharedAt: true,
        onboardingCompletedAt: true,
        onboardingDismissedAt: true,
      },
    }),
    prisma.service.count({
      where: { companyId, isActive: true },
    }),
    prisma.user.count({
      where: {
        companyId,
        isActive: true,
        isBookable: true,
        workingHours: { some: {} },
      },
    }),
  ]);

  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }

  const steps = {
    profileComplete: Boolean(company.phone?.trim() && company.address?.trim()),
    hasServices: activeServicesCount >= 1,
    hasBookableMaster: bookableMastersCount >= 1,
    linkShared: Boolean(company.onboardingLinkSharedAt),
  };

  const completedCount = Object.values(steps).filter(Boolean).length;
  const allDone = completedCount === 4;

  if (allDone && !company.onboardingCompletedAt) {
    await prisma.company.update({
      where: { id: companyId },
      data: { onboardingCompletedAt: clockNow() },
    });
  }

  const isCompleted = allDone || Boolean(company.onboardingCompletedAt);
  const isDismissed = Boolean(company.onboardingDismissedAt);

  return {
    businessType: company.businessType,
    companySlug: company.slug,
    steps,
    completedCount,
    totalSteps: 4,
    isCompleted,
    isDismissed,
    showChecklist: !isCompleted && !isDismissed,
  };
}

export async function getOnboardingPresets(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { businessType: true },
  });
  if (!company) {
    throw new AppError('NOT_FOUND', 404, 'Company not found');
  }
  return getPresetsForBusinessType(company.businessType);
}

export async function applyOnboarding(
  companyId: string,
  ownerUserId: string,
  input: ApplyOnboardingBody,
): Promise<OnboardingStateDto> {
  if (input.firstMaster) {
    await assertWithinStaffLimit(companyId, 1);
  }

  const presetById = new Map(SERVICE_PRESETS.map((p) => [p.id, p]));

  await prisma.$transaction(async (tx) => {
    if (input.phone !== undefined || input.address !== undefined) {
      await tx.company.update({
        where: { id: companyId },
        data: {
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
        },
      });
    }

    const existingServices = await tx.service.findMany({
      where: { companyId },
      select: { id: true, name: true },
    });
    const existingNames = new Set(existingServices.map((s) => s.name.trim().toLowerCase()));
    const allServiceIds = existingServices.map((s) => s.id);

    for (const item of input.services) {
      const preset = item.presetId ? presetById.get(item.presetId) : undefined;
      const serviceName = (item.name ?? preset?.name ?? '').trim();
      if (serviceName.length < 2) {
        throw new AppError('VALIDATION_ERROR', 400, 'Service name or valid presetId is required');
      }
      const key = serviceName.toLowerCase();
      if (existingNames.has(key)) {
        continue; // Idempotent: skip existing service name
      }

      const createdSvc = await tx.service.create({
        data: {
          companyId,
          name: serviceName,
          durationMin: item.durationMin,
          price: new Prisma.Decimal(item.price),
          isActive: true,
        },
      });
      existingNames.add(key);
      allServiceIds.push(createdSvc.id);
    }

    const defaultDays = [1, 2, 3, 4, 5, 6]; // Mon-Sat 10:00-20:00 per BR-21

    if (input.ownerServesClients) {
      await tx.user.update({
        where: { id: ownerUserId },
        data: { isBookable: true },
      });

      if (allServiceIds.length > 0) {
        await tx.masterService.createMany({
          data: allServiceIds.map((serviceId) => ({ userId: ownerUserId, serviceId })),
          skipDuplicates: true,
        });
      }

      if (input.applyDefaultHours) {
        const existingOwnerHours = await tx.workingHours.count({
          where: { userId: ownerUserId },
        });
        if (existingOwnerHours === 0) {
          await tx.workingHours.createMany({
            data: defaultDays.map((dayOfWeek) => ({
              userId: ownerUserId,
              dayOfWeek,
              startTime: '10:00',
              endTime: '20:00',
            })),
          });
        }
      }
    }

    if (input.firstMaster) {
      const createdMaster = await tx.user.create({
        data: {
          companyId,
          role: Role.MASTER,
          name: input.firstMaster.name,
          phone: input.firstMaster.phone ?? null,
          isActive: true,
          isBookable: true,
        },
      });

      if (allServiceIds.length > 0) {
        await tx.masterService.createMany({
          data: allServiceIds.map((serviceId) => ({ userId: createdMaster.id, serviceId })),
          skipDuplicates: true,
        });
      }

      if (input.applyDefaultHours) {
        await tx.workingHours.createMany({
          data: defaultDays.map((dayOfWeek) => ({
            userId: createdMaster.id,
            dayOfWeek,
            startTime: '10:00',
            endTime: '20:00',
          })),
        });
      }
    }
  });

  return getOnboardingState(companyId);
}

export async function dismissOnboarding(companyId: string): Promise<OnboardingStateDto> {
  await prisma.company.update({
    where: { id: companyId },
    data: { onboardingDismissedAt: clockNow() },
  });
  return getOnboardingState(companyId);
}

export async function markOnboardingLinkShared(companyId: string): Promise<OnboardingStateDto> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { onboardingLinkSharedAt: true },
  });
  if (company && !company.onboardingLinkSharedAt) {
    await prisma.company.update({
      where: { id: companyId },
      data: { onboardingLinkSharedAt: clockNow() },
    });
  }
  return getOnboardingState(companyId);
}
