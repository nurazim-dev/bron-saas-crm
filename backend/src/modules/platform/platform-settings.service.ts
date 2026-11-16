import { z } from 'zod';
import { now as clockNow } from '../../lib/clock.js';
import { prisma } from '../../lib/prisma.js';
import type { DbClient } from '../availability/availability.service.js';

export interface PlatformSettingsDto {
  trialDays: number;
  graceDays: number;
  trialPlanCode: string;
  registrationOpen: boolean;
  billingPaymentInstructions: string;
  supportPhone: string;
  supportWhatsapp: string;
  supportEmail: string;
  announcementEnabled: boolean;
  announcementText: string;
}

const DEFAULT_SETTINGS: PlatformSettingsDto = {
  trialDays: 14,
  graceDays: 3,
  trialPlanCode: 'BUSINESS',
  registrationOpen: true,
  billingPaymentInstructions: '',
  supportPhone: '',
  supportWhatsapp: '',
  supportEmail: '',
  announcementEnabled: false,
  announcementText: '',
};

const platformSettingsSchema = z.object({
  trialDays: z.number().int().min(1).max(90).catch(DEFAULT_SETTINGS.trialDays),
  graceDays: z.number().int().min(0).max(30).catch(DEFAULT_SETTINGS.graceDays),
  trialPlanCode: z.string().min(1).catch(DEFAULT_SETTINGS.trialPlanCode),
  registrationOpen: z.boolean().catch(DEFAULT_SETTINGS.registrationOpen),
  billingPaymentInstructions: z.string().catch(DEFAULT_SETTINGS.billingPaymentInstructions),
  supportPhone: z.string().catch(DEFAULT_SETTINGS.supportPhone),
  supportWhatsapp: z.string().catch(DEFAULT_SETTINGS.supportWhatsapp),
  supportEmail: z.string().catch(DEFAULT_SETTINGS.supportEmail),
  announcementEnabled: z.boolean().catch(DEFAULT_SETTINGS.announcementEnabled),
  announcementText: z.string().catch(DEFAULT_SETTINGS.announcementText),
});

export async function getPlatformSettings(db: DbClient = prisma): Promise<PlatformSettingsDto> {
  const rows = await db.platformSetting.findMany();
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    raw[row.key] = row.value;
  }

  return platformSettingsSchema.parse({
    trialDays: raw.trialDays,
    graceDays: raw.graceDays,
    trialPlanCode: raw.trialPlanCode,
    registrationOpen: raw.registrationOpen,
    billingPaymentInstructions: raw.billingPaymentInstructions,
    supportPhone: raw.supportPhone,
    supportWhatsapp: raw.supportWhatsapp,
    supportEmail: raw.supportEmail,
    announcementEnabled: raw.announcementEnabled,
    announcementText: raw.announcementText,
  });
}

export interface PublicPlanDto {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  currency: string;
  maxStaff: number;
  maxRemindersPerMonth: number | null;
  featureAnalytics: boolean;
  featureAutoReminders: boolean;
  featurePrepayment: boolean;
  sortOrder: number;
}

export interface PublicPlatformDto {
  plans: PublicPlanDto[];
  support: {
    phone: string;
    whatsapp: string;
    email: string;
  };
  announcement: {
    enabled: boolean;
    text: string;
  };
  registrationOpen: boolean;
}

const PUBLIC_PLATFORM_CACHE_TTL_MS = 60_000;
let cachedPublicPlatform: { data: PublicPlatformDto; expiresAtMs: number } | null = null;

export function invalidatePublicPlatformCache(): void {
  cachedPublicPlatform = null;
}

export async function getPublicPlatformInfo(): Promise<PublicPlatformDto> {
  const currentNowMs = clockNow().getTime();
  if (cachedPublicPlatform && currentNowMs < cachedPublicPlatform.expiresAtMs) {
    return cachedPublicPlatform.data;
  }

  const [settings, plans] = await Promise.all([
    getPlatformSettings(prisma),
    prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  const data: PublicPlatformDto = {
    plans: plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      priceMonthly: p.priceMonthly.toFixed(2),
      currency: p.currency,
      maxStaff: p.maxStaff,
      maxRemindersPerMonth: p.maxRemindersPerMonth,
      featureAnalytics: p.featureAnalytics,
      featureAutoReminders: p.featureAutoReminders,
      featurePrepayment: p.featurePrepayment,
      sortOrder: p.sortOrder,
    })),
    support: {
      phone: settings.supportPhone,
      whatsapp: settings.supportWhatsapp,
      email: settings.supportEmail,
    },
    announcement: {
      enabled: settings.announcementEnabled,
      text: settings.announcementText,
    },
    registrationOpen: settings.registrationOpen,
  };

  cachedPublicPlatform = {
    data,
    expiresAtMs: currentNowMs + PUBLIC_PLATFORM_CACHE_TTL_MS,
  };

  return data;
}
