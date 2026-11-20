import { z } from 'zod';
import {
  AuditActor,
  BusinessType,
  NotificationChannel,
  OutboxStatus,
  PaymentMethod,
  PaymentStatus,
  Role,
  SubscriptionStatus,
} from '../../generated/prisma/client.js';
import { sanitizeText } from '../../lib/phone.js';

export const uuidParamsSchema = z.object({
  id: z.uuid({ message: 'ID must be a valid UUID' }),
});

export type UuidParams = z.infer<typeof uuidParamsSchema>;

export const adminPaymentProofParamsSchema = z.object({
  id: z.uuid({ message: 'Payment ID must be a valid UUID' }),
  proofId: z.uuid({ message: 'Proof ID must be a valid UUID' }),
});

export type AdminPaymentProofParams = z.infer<typeof adminPaymentProofParamsSchema>;

export const adminSignupsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export type AdminSignupsQuery = z.infer<typeof adminSignupsQuerySchema>;

export const adminCompaniesQuerySchema = z.object({
  search: z
    .string()
    .transform((v) => sanitizeText(v))
    .optional(),
  status: z.enum(SubscriptionStatus).optional(),
  plan: z.string().trim().optional(),
  businessType: z.enum(BusinessType).optional(),
  includeDeleted: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sortBy: z.enum(['createdAt', 'name', 'periodEndsAt']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminCompaniesQuery = z.infer<typeof adminCompaniesQuerySchema>;

export const adminUpdateCompanyBodySchema = z
  .object({
    name: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(2).max(100))
      .optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid slug format')
      .min(3)
      .max(60)
      .optional(),
    businessType: z.enum(BusinessType).optional(),
    publicBookingEnabled: z.boolean().optional(),
  })
  .strict();

export type AdminUpdateCompanyBody = z.infer<typeof adminUpdateCompanyBodySchema>;

export const adminReasonBodySchema = z
  .object({
    reason: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(3, 'Reason must be at least 3 characters').max(500)),
  })
  .strict();

export type AdminReasonBody = z.infer<typeof adminReasonBodySchema>;

export const adminDeleteCompanyBodySchema = z
  .object({
    confirmSlug: z.string().trim().min(1).max(100),
  })
  .strict();

export type AdminDeleteCompanyBody = z.infer<typeof adminDeleteCompanyBodySchema>;

export const adminAdjustSubscriptionBodySchema = z
  .object({
    planId: z.uuid().optional(),
    periodEndsAt: z.iso.datetime({ offset: true }).optional(),
    isTrial: z.boolean().optional(),
    reason: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(3).max(500)),
  })
  .strict();

export type AdminAdjustSubscriptionBody = z.infer<typeof adminAdjustSubscriptionBodySchema>;

export const adminRecordOfflinePaymentBodySchema = z
  .object({
    planId: z.uuid(),
    months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
    method: z.enum(PaymentMethod),
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
    reference: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().max(120))
      .optional(),
    comment: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().max(500))
      .optional(),
    reason: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(3).max(500)),
  })
  .strict();

export type AdminRecordOfflinePaymentBody = z.infer<typeof adminRecordOfflinePaymentBodySchema>;

export const adminPaymentsQuerySchema = z.object({
  status: z.enum(PaymentStatus).optional(),
  companyId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminPaymentsQuery = z.infer<typeof adminPaymentsQuerySchema>;

export const adminCreatePlanBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,30}$/),
    name: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(2).max(60)),
    description: z
      .union([
        z
          .string()
          .transform((v) => sanitizeText(v))
          .pipe(z.string().max(400)),
        z.null(),
      ])
      .optional(),
    priceMonthly: z.string().regex(/^\d+(\.\d{1,2})?$/),
    maxStaff: z.number().int().min(1).max(1000),
    maxServices: z.number().int().min(1).max(10_000).nullable().optional(),
    maxAppointmentsPerMonth: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxRemindersPerMonth: z.number().int().min(0).max(1_000_000).nullable().optional(),
    featureAnalytics: z.boolean().default(false),
    featureAutoReminders: z.boolean().default(false),
    featurePrepayment: z.boolean().default(false),
    featureCrmAdvanced: z.boolean().default(true),
    featureManualPayments: z.boolean().default(true),
    featureMultiCompany: z.boolean().default(true),
    featureCustomBranding: z.boolean().default(false),
    isPublic: z.boolean().default(true),
    isLegacy: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(10),
  })
  .strict();

export type AdminCreatePlanBody = z.infer<typeof adminCreatePlanBodySchema>;

export const adminUpdatePlanBodySchema = z
  .object({
    name: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(2).max(60))
      .optional(),
    description: z
      .union([
        z
          .string()
          .transform((v) => sanitizeText(v))
          .pipe(z.string().max(400)),
        z.null(),
      ])
      .optional(),
    priceMonthly: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .optional(),
    maxStaff: z.number().int().min(1).max(1000).optional(),
    maxServices: z.number().int().min(1).max(10_000).nullable().optional(),
    maxAppointmentsPerMonth: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxRemindersPerMonth: z.number().int().min(0).max(1_000_000).nullable().optional(),
    featureAnalytics: z.boolean().optional(),
    featureAutoReminders: z.boolean().optional(),
    featurePrepayment: z.boolean().optional(),
    featureCrmAdvanced: z.boolean().optional(),
    featureManualPayments: z.boolean().optional(),
    featureMultiCompany: z.boolean().optional(),
    featureCustomBranding: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isPublic: z.boolean().optional(),
    isLegacy: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export type AdminUpdatePlanBody = z.infer<typeof adminUpdatePlanBodySchema>;

export const adminUsersQuerySchema = z.object({
  search: z
    .string()
    .transform((v) => sanitizeText(v))
    .optional(),
  role: z.enum(Role).optional(),
  companyId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export const adminUpdateUserBodySchema = z
  .object({
    name: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(2).max(100))
      .optional(),
    phone: z.union([z.string().transform((v) => sanitizeText(v)), z.null()]).optional(),
    email: z
      .string()
      .transform((v) => sanitizeText(v).toLowerCase())
      .pipe(z.email())
      .optional(),
  })
  .strict();

export type AdminUpdateUserBody = z.infer<typeof adminUpdateUserBodySchema>;

export const adminUserPasswordResetBodySchema = z
  .object({
    sendEmail: z.boolean().optional().default(false),
  })
  .strict()
  .optional()
  .default({ sendEmail: false });

export type AdminUserPasswordResetBody = z.infer<typeof adminUserPasswordResetBodySchema>;

export const adminOutboxQuerySchema = z.object({
  status: z.enum(OutboxStatus).optional(),
  channel: z.enum(NotificationChannel).optional(),
  kind: z.string().trim().optional(),
  companyId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminOutboxQuery = z.infer<typeof adminOutboxQuerySchema>;

export const adminAuditQuerySchema = z.object({
  companyId: z.uuid().optional(),
  actorType: z.enum(AuditActor).optional(),
  action: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

export const adminUpdateSettingsBodySchema = z
  .object({
    trialDays: z.number().int().min(1).max(90).optional(),
    graceDays: z.number().int().min(0).max(30).optional(),
    trialPlanCode: z.string().trim().min(1).max(40).optional(),
    registrationOpen: z.boolean().optional(),
    billingPaymentInstructions: z.string().max(2000).optional(),
    supportPhone: z.string().max(40).optional(),
    supportWhatsapp: z.string().max(40).optional(),
    supportEmail: z.union([z.email(), z.literal('')]).optional(),
    announcementEnabled: z.boolean().optional(),
    announcementText: z.string().max(500).optional(),
  })
  .strict();

export type AdminUpdateSettingsBody = z.infer<typeof adminUpdateSettingsBodySchema>;
