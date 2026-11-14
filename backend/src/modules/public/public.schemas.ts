import { z } from 'zod';
import { parseNormalizedStartAtUtc } from '../../lib/datetime.js';
import { normalizePhoneE164, sanitizeText } from '../../lib/phone.js';
import { getAvailabilityQuerySchema } from '../availability/availability.schemas.js';

export const companySlugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'Company slug is required')
    .max(60, 'Company slug must be at most 60 characters'),
});

export type CompanySlugParams = z.infer<typeof companySlugParamsSchema>;

export const getPublicAvailabilityQuerySchema = getAvailabilityQuerySchema;
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

export const createPublicAppointmentBodySchema = z
  .object({
    serviceId: z.uuid({ message: 'serviceId must be a valid UUID' }),
    masterId: z.uuid({ message: 'masterId must be a valid UUID' }),
    startAt: startAtSchema,
    clientName: clientNameSchema,
    clientPhone: clientPhoneSchema,
    clientNote: clientNoteSchema,
    website: z.string().optional().default(''),
  })
  .strict();

export type CreatePublicAppointmentBody = z.infer<typeof createPublicAppointmentBodySchema>;
