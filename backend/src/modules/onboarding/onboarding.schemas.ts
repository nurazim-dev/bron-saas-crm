import { z } from 'zod';
import { normalizePhoneE164, sanitizeText } from '../../lib/phone.js';

const presetServiceItemSchema = z
  .object({
    presetId: z.string().trim().min(1).max(80).optional(),
    name: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(2).max(100))
      .optional(),
    durationMin: z
      .number()
      .int()
      .min(5)
      .max(720)
      .refine((v) => v % 5 === 0, { message: 'durationMin must be a multiple of 5' }),
    price: z.union([z.number(), z.string()]).transform((val, ctx): string => {
      const str = typeof val === 'number' ? String(val) : val.trim();
      if (!/^\d+(?:\.\d{1,2})?$/.test(str)) {
        ctx.addIssue({ code: 'custom', message: 'Invalid price' });
        return z.NEVER;
      }
      const num = Number(str);
      if (!Number.isFinite(num) || num < 0 || num > 1_000_000) {
        ctx.addIssue({ code: 'custom', message: 'Invalid price range' });
        return z.NEVER;
      }
      return num.toFixed(2);
    }),
  })
  .strict();

const phoneOptionalSchema = z
  .string()
  .transform((val, ctx): string => {
    try {
      return normalizePhoneE164(val, 'phone');
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid phone number' });
      return z.NEVER;
    }
  })
  .optional();

export const applyOnboardingBodySchema = z
  .object({
    phone: phoneOptionalSchema,
    address: z
      .string()
      .transform((v) => sanitizeText(v))
      .pipe(z.string().min(2).max(255))
      .optional(),
    services: z.array(presetServiceItemSchema).max(30).optional().default([]),
    ownerServesClients: z.boolean().optional().default(true),
    applyDefaultHours: z.boolean().optional().default(true),
    firstMaster: z
      .object({
        name: z
          .string()
          .transform((v) => sanitizeText(v))
          .pipe(z.string().min(2).max(100)),
        phone: phoneOptionalSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export type ApplyOnboardingBody = z.infer<typeof applyOnboardingBodySchema>;
