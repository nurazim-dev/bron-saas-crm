import { z } from 'zod';
import { parseNormalizedStartAtUtc } from '../../lib/datetime.js';
import { normalizePhoneE164, sanitizeText } from '../../lib/phone.js';
import { localDateQuerySchema } from '../availability/availability.schemas.js';

export const companySlugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'Company slug is required')
    .max(60, 'Company slug must be at most 60 characters'),
});

export type CompanySlugParams = z.infer<typeof companySlugParamsSchema>;

const publicMasterIdQuerySchema = z
  .union([z.literal('ANY'), z.uuid({ message: 'masterId must be a valid UUID or ANY' })])
  .optional();

export const getPublicAvailabilityQuerySchema = z.object({
  serviceId: z.uuid({ message: 'serviceId must be a valid UUID' }),
  masterId: publicMasterIdQuerySchema,
  date: localDateQuerySchema,
});

export type GetPublicAvailabilityQuery = z.infer<typeof getPublicAvailabilityQuerySchema>;

const startAtSchema = z.string().transform((val, ctx): Date => {
  try {
    return parseNormalizedStartAtUtc(val.trim());
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'startAt must be a valid ISO-8601 instant',
    });
    return z.NEVER;
  }
});

const clientNameSchema = z
  .string()
  .transform((val) => sanitizeText(val))
  .pipe(
    z
      .string()
      .min(2, 'Client name must be at least 2 characters')
      .max(100, 'Client name must be at most 100 characters'),
  );

const clientPhoneSchema = z.string().transform((val, ctx): string => {
  try {
    return normalizePhoneE164(val, 'clientPhone');
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Invalid phone number format',
    });
    return z.NEVER;
  }
});

const clientNoteSchema = z
  .union([
    z
      .string()
      .transform((val) => sanitizeText(val))
      .pipe(z.string().max(500, 'Note must be at most 500 characters')),
    z.null(),
  ])
  .optional();

const publicMasterIdBodySchema = z
  .union([z.literal('ANY'), z.uuid({ message: 'masterId must be a valid UUID or ANY' }), z.null()])
  .optional();

export const createPublicAppointmentBodySchema = z
  .object({
    serviceId: z.uuid({ message: 'serviceId must be a valid UUID' }),
    masterId: publicMasterIdBodySchema,
    startAt: startAtSchema,
    clientName: clientNameSchema,
    clientPhone: clientPhoneSchema,
    clientNote: clientNoteSchema,
    consentAccepted: z.literal(true, {
      message: 'Consent to personal data processing is required',
    }),
    locale: z.enum(['RU', 'KY']).optional(),
    website: z.string().optional().default(''),
  })
  .strict();

export type CreatePublicAppointmentBody = z.infer<typeof createPublicAppointmentBodySchema>;

export const manageTokenParamsSchema = z.object({
  token: z.string().trim().min(16).max(128),
});

export const publicManageAvailabilityQuerySchema = z.object({
  date: localDateQuerySchema,
});

export const publicManageCancelBodySchema = z
  .object({
    reason: z
      .string()
      .transform((val) => sanitizeText(val))
      .pipe(z.string().max(500))
      .nullable()
      .optional(),
  })
  .strict()
  .optional()
  .default({});

export const publicManageRescheduleBodySchema = z
  .object({
    startAt: startAtSchema,
  })
  .strict();

export type ManageTokenParams = z.infer<typeof manageTokenParamsSchema>;
export type PublicManageAvailabilityQuery = z.infer<typeof publicManageAvailabilityQuerySchema>;
export type PublicManageCancelBody = z.infer<typeof publicManageCancelBodySchema>;
export type PublicManageRescheduleBody = z.infer<typeof publicManageRescheduleBodySchema>;
