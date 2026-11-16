import { IANAZone } from 'luxon';
import { z } from 'zod';
import { BusinessType } from '../../generated/prisma/client.js';
import { sanitizeText } from '../../lib/phone.js';
import { SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, SLUG_REGEX } from '../../lib/slug.js';

const ianaTimezoneSchema = z
  .string()
  .transform((val) => sanitizeText(val))
  .refine((tz) => tz.length > 0 && IANAZone.isValidZone(tz), {
    message: 'Must be a valid IANA time zone (e.g. Asia/Bishkek)',
  });

const slugSchema = z
  .string()
  .transform((val) => sanitizeText(val).toLowerCase())
  .pipe(
    z
      .string()
      .min(SLUG_MIN_LENGTH, `Slug must be at least ${SLUG_MIN_LENGTH} characters`)
      .max(SLUG_MAX_LENGTH, `Slug must be at most ${SLUG_MAX_LENGTH} characters`)
      .regex(SLUG_REGEX, 'Slug may only contain lowercase letters, digits and single hyphens'),
  );

export const updateCompanyBodySchema = z
  .object({
    name: z
      .string()
      .transform((val) => sanitizeText(val))
      .pipe(z.string().min(2).max(100))
      .optional(),
    businessType: z.enum(BusinessType).optional(),
    phone: z.union([z.string().transform((val) => sanitizeText(val)), z.null()]).optional(),
    address: z
      .union([
        z
          .string()
          .transform((val) => sanitizeText(val))
          .pipe(z.string().max(300)),
        z.null(),
      ])
      .optional(),
    timezone: ianaTimezoneSchema.optional(),
    slug: slugSchema.optional(),
    slotIntervalMin: z.number().int().min(5).max(120).optional(),
    minLeadTimeMin: z.number().int().min(0).max(10_080).optional(),
    maxAdvanceDays: z.number().int().min(1).max(365).optional(),
    publicBookingEnabled: z.boolean().optional(),
    clientCancelMinHours: z.number().int().min(0).max(168).optional(),
    allowClientReschedule: z.boolean().optional(),
  })
  .strict();

export type UpdateCompanyBody = z.infer<typeof updateCompanyBodySchema>;
