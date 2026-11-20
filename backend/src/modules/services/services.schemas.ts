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

const prepaymentValueSchema = z
  .union([z.number(), z.string(), z.null()])
  .transform((val, ctx): string | null => {
    if (val === null) return null;
    const str = typeof val === 'number' ? String(val) : val.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(str)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Prepayment value must be a positive number with at most 2 decimal places',
      });
      return z.NEVER;
    }
    const num = Number(str);
    if (!Number.isFinite(num) || num <= 0 || num > 1_000_000) {
      ctx.addIssue({
        code: 'custom',
        message: 'Prepayment value must be greater than 0 and at most 1,000,000',
      });
      return z.NEVER;
    }
    return num.toFixed(2);
  })
  .optional();

export const createServiceBodySchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    durationMin: durationMinSchema,
    price: priceSchema,
    isActive: z.boolean().optional().default(true),
    requiresPrepayment: z.boolean().optional().default(false),
    prepaymentMode: z.enum(['FIXED', 'PERCENT']).nullable().optional(),
    prepaymentValue: prepaymentValueSchema,
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
    requiresPrepayment: z.boolean().optional(),
    prepaymentMode: z.enum(['FIXED', 'PERCENT']).nullable().optional(),
    prepaymentValue: prepaymentValueSchema,
  })
  .strict();

export type UpdateServiceBody = z.infer<typeof updateServiceBodySchema>;

const packageServiceIdsSchema = z
  .array(z.uuid({ message: 'Each serviceId must be a valid UUID' }))
  .min(2, 'Service package must contain at least 2 services')
  .max(10, 'Service package can contain at most 10 services')
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Duplicate services are not allowed in a package',
  });

export const createServicePackageBodySchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    price: priceSchema,
    serviceIds: packageServiceIdsSchema,
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export type CreateServicePackageBody = z.infer<typeof createServicePackageBodySchema>;

export const updateServicePackageBodySchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema,
    price: priceSchema.optional(),
    serviceIds: packageServiceIdsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export type UpdateServicePackageBody = z.infer<typeof updateServicePackageBodySchema>;
