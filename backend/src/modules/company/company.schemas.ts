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

const RESERVED_CUSTOM_DOMAINS = new Set(['zapis.kg', 'www.zapis.kg', 'localhost', '127.0.0.1']);
const CUSTOM_DOMAIN_REGEX =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const customDomainSchema = z
  .union([
    z
      .string()
      .transform((val) => sanitizeText(val).toLowerCase())
      .refine(
        (val) =>
          val.length === 0 ||
          (val.length <= 253 && CUSTOM_DOMAIN_REGEX.test(val) && !RESERVED_CUSTOM_DOMAINS.has(val)),
        {
          message: 'Укажите корректное доменное имя (например, booking.mysalon.kg)',
        },
      ),
    z.null(),
  ])
  .optional();

const brandColorSchema = z
  .union([
    z
      .string()
      .trim()
      .refine((val) => val.length === 0 || /^#[0-9a-fA-F]{6}$/.test(val), {
        message: 'Цвет бренда должен быть в формате #RRGGBB',
      }),
    z.null(),
  ])
  .optional();

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
    description: z
      .union([
        z
          .string()
          .transform((val) => sanitizeText(val))
          .pipe(z.string().max(600)),
        z.null(),
      ])
      .optional(),
    brandColor: brandColorSchema,
    customDomain: customDomainSchema,
    instagramUrl: z
      .union([
        z
          .string()
          .transform((val) => sanitizeText(val))
          .pipe(z.string().max(200)),
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
    defaultLocale: z.enum(['RU', 'KY', 'EN']).optional(),
    reminderMode: z.enum(['OFF', 'MANUAL', 'AUTO']).optional(),
    remind24h: z.boolean().optional(),
    remind2h: z.boolean().optional(),
    paymentInstructions: z
      .union([
        z.string().trim().max(1000, 'Payment instructions must be at most 1000 characters'),
        z.null(),
      ])
      .optional(),
    prepaymentHoldMin: z
      .number()
      .int()
      .refine((v) => v === 0 || (v >= 15 && v <= 1440), {
        message: 'Prepayment hold minutes must be 0 or between 15 and 1440',
      })
      .optional(),
  })
  .strict();

export type UpdateCompanyBody = z.infer<typeof updateCompanyBodySchema>;
