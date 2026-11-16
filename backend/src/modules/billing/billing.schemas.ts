import { z } from 'zod';
import { PaymentMethod } from '../../generated/prisma/client.js';
import { sanitizeText } from '../../lib/phone.js';

export const paymentIdParamsSchema = z.object({
  id: z.uuid({ message: 'Payment ID must be a valid UUID' }),
});

export type PaymentIdParams = z.infer<typeof paymentIdParamsSchema>;

export const createPaymentClaimBodySchema = z
  .object({
    planId: z.uuid({ message: 'planId must be a valid UUID' }),
    months: z
      .number()
      .int()
      .refine((v) => v === 1 || v === 3 || v === 6 || v === 12, {
        message: 'months must be 1, 3, 6, or 12',
      }),
    method: z.enum(PaymentMethod),
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
  })
  .strict();

export type CreatePaymentClaimBody = z.infer<typeof createPaymentClaimBodySchema>;

export const listPaymentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
