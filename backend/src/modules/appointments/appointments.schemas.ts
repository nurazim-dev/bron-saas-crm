import { serviceIdsSchema } from './service-selection.js';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { AppointmentStatus, PrepaymentStatus } from '../../generated/prisma/client.js';
import { parseNormalizedStartAtUtc } from '../../lib/datetime.js';
import { normalizePhoneE164, sanitizeText } from '../../lib/phone.js';

const MAX_LIST_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

export const appointmentIdParamsSchema = z.object({
  id: z.uuid({ message: 'Appointment ID must be a valid UUID' }),
});

export type AppointmentIdParams = z.infer<typeof appointmentIdParamsSchema>;

const isoInstantQuerySchema = z.string().transform((val, ctx): Date => {
  const dt = DateTime.fromISO(val.trim(), { setZone: true });
  if (!dt.isValid) {
    ctx.addIssue({
      code: 'custom',
      message: 'Must be a valid ISO-8601 UTC instant',
    });
    return z.NEVER;
  }
  return dt.toUTC().toJSDate();
});

export const listAppointmentsQuerySchema = z
  .object({
    from: isoInstantQuerySchema,
    to: isoInstantQuerySchema,
    masterId: z.uuid({ message: 'masterId must be a valid UUID' }).optional(),
    status: z.enum(AppointmentStatus).optional(),
    prepaymentStatus: z.enum(PrepaymentStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((data) => data.from.getTime() < data.to.getTime(), {
    path: ['to'],
    message: '"to" must be strictly after "from"',
  })
  .refine((data) => data.to.getTime() - data.from.getTime() <= MAX_LIST_RANGE_MS, {
    path: ['to'],
    message: 'Date range between "from" and "to" must not exceed 62 days',
  });

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const prepaymentActionBodySchema = z
  .object({
    action: z.enum(['RECEIVED', 'WAIVE', 'REFUND']),
  })
  .strict();

export type PrepaymentActionBody = z.infer<typeof prepaymentActionBodySchema>;

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

const noteSchema = z
  .union([
    z
      .string()
      .transform((val) => sanitizeText(val))
      .pipe(z.string().max(500, 'Note must be at most 500 characters')),
    z.null(),
  ])
  .optional();

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

export const createAppointmentBodySchema = z
  .object({
    masterId: z.uuid({ message: 'masterId must be a valid UUID' }),
    serviceId: z.uuid({ message: 'serviceId must be a valid UUID' }).optional(),
    serviceIds: serviceIdsSchema.optional(),
    packageId: z.uuid({ message: 'packageId must be a valid UUID' }).optional(),
    startAt: startAtSchema,
    clientName: clientNameSchema,
    clientPhone: clientPhoneSchema,
    clientNote: noteSchema,
    internalNote: noteSchema,
    price: priceSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.serviceId && !data.packageId) {
      ctx.addIssue({
        code: 'custom',
        path: ['serviceId'],
        message: 'Either serviceId or packageId is required',
      });
    }
    if (data.packageId && (data.serviceId !== undefined || data.serviceIds !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['packageId'],
        message: 'Cannot combine packageId with serviceId or serviceIds',
      });
    }
  });

export type CreateAppointmentBody = z.infer<typeof createAppointmentBodySchema>;

export const updateAppointmentBodySchema = z
  .object({
    masterId: z.uuid({ message: 'masterId must be a valid UUID' }).optional(),
    serviceId: z.uuid({ message: 'serviceId must be a valid UUID' }).optional(),
    serviceIds: serviceIdsSchema.optional(),
    startAt: startAtSchema.optional(),
    clientName: clientNameSchema.optional(),
    clientPhone: clientPhoneSchema.optional(),
    clientNote: noteSchema,
    internalNote: noteSchema,
    price: priceSchema.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export type UpdateAppointmentBody = z.infer<typeof updateAppointmentBodySchema>;

export const updateAppointmentStatusBodySchema = z
  .object({
    status: z.enum(AppointmentStatus),
  })
  .strict();

export type UpdateAppointmentStatusBody = z.infer<typeof updateAppointmentStatusBodySchema>;
