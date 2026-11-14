import { z } from 'zod';
import { sanitizeText } from '../../lib/phone.js';

export const serviceIdParamsSchema = z.object({
  id: z.uuid({ message: 'Service ID must be a valid UUID' }),
});

export type ServiceIdParams = z.infer<typeof serviceIdParamsSchema>;

const nameSchema = z
  .string()
  .transform((val) => sanitizeText(val))
  .pipe(
    z
      .string()
      .min(2, 'Service name must be at least 2 characters')
      .max(100, 'Service name must be at most 100 characters'),
  );

const descriptionSchema = z
  .union([
    z
      .string()
      .transform((val) => sanitizeText(val))
      .pipe(z.string().max(500, 'Description must be at most 500 characters')),
    z.null(),
  ])
  .optional();

const durationMinSchema = z
  .number()
  .int('Duration must be an integer')
  .min(5, 'Duration must be at least 5 minutes')
  .max(720, 'Duration must be at most 720 minutes')
  .refine((val) => val % 5 === 0, { message: 'Duration must be a multiple of 5 minutes' });

const priceSchema = z.union([z.number(), z.string()]).transform((val, ctx): string => {
  const str = typeof val === 'number' ? String(val) : val.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(str)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Price must be a non-negative amount with at most 2 decimal places',
    });
    return z.NEVER;
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0 || num > 1_000_000) {
    ctx.addIssue({
      code: 'custom',
      message: 'Price must be between 0 and 1,000,000',
    });
    return z.NEVER;
  }
  return num.toFixed(2);
});

export const createServiceBodySchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    durationMin: durationMinSchema,
    price: priceSchema,
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export type CreateServiceBody = z.infer<typeof createServiceBodySchema>;

export const updateServiceBodySchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema,
    durationMin: durationMinSchema.optional(),
    price: priceSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateServiceBody = z.infer<typeof updateServiceBodySchema>;
