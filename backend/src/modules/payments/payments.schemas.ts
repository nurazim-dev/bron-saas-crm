import { z } from 'zod';
import {
  BusinessPaymentKind,
  BusinessPaymentStatus,
  PaymentMethod,
} from '../../generated/prisma/client.js';

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const paymentProofParamsSchema = z.object({
  id: z.string().uuid(),
  proofId: z.string().uuid(),
});

export const listBusinessPaymentsQuerySchema = z.object({
  status: z.nativeEnum(BusinessPaymentStatus).optional(),
  kind: z.nativeEnum(BusinessPaymentKind).optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  appointmentId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  from: ymdDateSchema.optional(),
  to: ymdDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const businessPaymentsSummaryQuerySchema = z.object({
  from: ymdDateSchema,
  to: ymdDateSchema,
});

export const createBusinessPaymentSchema = z.object({
  appointmentId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  kind: z.nativeEnum(BusinessPaymentKind).default(BusinessPaymentKind.PAYMENT),
  amount: z
    .union([z.number(), z.string()])
    .transform((v) => String(v).trim())
    .refine(
      (v) => /^\d+(?:\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 1_000_000,
      'Amount must be positive and at most 1000000.00',
    ),
  method: z.nativeEnum(PaymentMethod),
  reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  confirmImmediately: z.boolean().default(false),
});

export const rejectBusinessPaymentSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export type ListBusinessPaymentsQuery = z.infer<typeof listBusinessPaymentsQuerySchema>;
export type BusinessPaymentsSummaryQuery = z.infer<typeof businessPaymentsSummaryQuerySchema>;
export type CreateBusinessPaymentInput = z.infer<typeof createBusinessPaymentSchema>;
export type RejectBusinessPaymentInput = z.infer<typeof rejectBusinessPaymentSchema>;
