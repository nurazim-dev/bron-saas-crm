import { z } from 'zod';
import { sanitizeText } from '../../lib/phone.js';

export const staffIdParamsSchema = z.object({
  id: z.uuid({ message: 'Staff ID must be a valid UUID' }),
});

export type StaffIdParams = z.infer<typeof staffIdParamsSchema>;

const nameSchema = z
  .string()
  .transform((val) => sanitizeText(val))
  .pipe(
    z
      .string()
      .min(2, 'Name must be at least 2 characters')
      .max(100, 'Name must be at most 100 characters'),
  );

export const inviteStaffBodySchema = z
  .object({
    name: nameSchema,
    email: z.email().trim().toLowerCase(),
    role: z.enum(['MASTER', 'MANAGER']).default('MASTER'),
  })
  .strict();

export type InviteStaffBody = z.infer<typeof inviteStaffBodySchema>;

const optionalEmailSchema = z
  .union([
    z
      .string()
      .transform((val) => sanitizeText(val).toLowerCase())
      .pipe(z.union([z.literal(''), z.email({ message: 'Must be a valid email address' })])),
    z.null(),
  ])
  .optional()
  .transform((val) => (val === undefined || val === null || val === '' ? undefined : val));

const optionalPasswordSchema = z
  .union([
    z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters'),
    z.literal(''),
    z.null(),
  ])
  .optional()
  .transform((val) => (val === undefined || val === null || val === '' ? undefined : val));

export const createStaffBodySchema = z
  .object({
    name: nameSchema,
    phone: z.union([z.string().transform((val) => sanitizeText(val)), z.null()]).optional(),
    email: optionalEmailSchema,
    password: optionalPasswordSchema,
    isActive: z.boolean().optional().default(true),
    isBookable: z.boolean().optional().default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasEmail = data.email !== undefined;
    const hasPassword = data.password !== undefined;
    if (hasEmail !== hasPassword) {
      ctx.addIssue({
        code: 'custom',
        path: [hasEmail ? 'password' : 'email'],
        message: 'Email and password must either both be provided or both be omitted',
      });
    }
  });

export type CreateStaffBody = z.infer<typeof createStaffBodySchema>;

export const updateStaffBodySchema = z
  .object({
    name: nameSchema.optional(),
    phone: z.union([z.string().transform((val) => sanitizeText(val)), z.null()]).optional(),
    email: z
      .union([
        z
          .string()
          .transform((val) => sanitizeText(val).toLowerCase())
          .pipe(z.union([z.literal(''), z.email({ message: 'Must be a valid email address' })])),
        z.null(),
      ])
      .optional(),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters')
      .optional(),
    isActive: z.boolean().optional(),
    isBookable: z.boolean().optional(),
  })
  .strict();

export type UpdateStaffBody = z.infer<typeof updateStaffBodySchema>;

const customPriceSchema = z
  .union([z.number(), z.string(), z.null()])
  .transform((val, ctx): string | null => {
    if (val === null) return null;
    const str = typeof val === 'number' ? String(val) : val.trim();
    if (str === '') return null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(str)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Custom price must be a non-negative amount with at most 2 decimal places',
      });
      return z.NEVER;
    }
    const num = Number(str);
    if (!Number.isFinite(num) || num < 0 || num > 1_000_000) {
      ctx.addIssue({
        code: 'custom',
        message: 'Custom price must be between 0 and 1,000,000',
      });
      return z.NEVER;
    }
    return num.toFixed(2);
  })
  .optional();

const customDurationMinSchema = z
  .union([
    z
      .number()
      .int('Custom duration must be an integer')
      .min(5, 'Custom duration must be at least 5 minutes')
      .max(720, 'Custom duration must be at most 720 minutes'),
    z.null(),
  ])
  .optional();

const serviceOverrideSchema = z
  .object({
    serviceId: z.uuid({ message: 'serviceId must be a valid UUID' }),
    customPrice: customPriceSchema,
    customDurationMin: customDurationMinSchema,
  })
  .strict();

export const replaceStaffServicesBodySchema = z
  .object({
    serviceIds: z
      .array(z.uuid({ message: 'Each serviceId must be a valid UUID' }))
      .max(200)
      .transform((ids) => Array.from(new Set(ids))),
    serviceOverrides: z.array(serviceOverrideSchema).max(200).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.serviceOverrides) return;
    const allowed = new Set(data.serviceIds);
    const seen = new Set<string>();
    data.serviceOverrides.forEach((item, index) => {
      if (!allowed.has(item.serviceId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['serviceOverrides', index, 'serviceId'],
          message: 'Override serviceId must be included in serviceIds',
        });
      }
      if (seen.has(item.serviceId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['serviceOverrides', index, 'serviceId'],
          message: 'Duplicate serviceId in serviceOverrides',
        });
      }
      seen.add(item.serviceId);
    });
  });

export type ReplaceStaffServicesBody = z.infer<typeof replaceStaffServicesBodySchema>;

const hhMmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseMinutes(hhMm: string): number {
  const [hoursStr, minutesStr] = hhMm.split(':');
  return Number(hoursStr) * 60 + Number(minutesStr);
}

const workingDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string().regex(hhMmRegex, 'startTime must be in HH:mm format (00:00..23:59)'),
    endTime: z.string().regex(hhMmRegex, 'endTime must be in HH:mm format (00:00..23:59)'),
    breakStart: z
      .string()
      .regex(hhMmRegex, 'breakStart must be in HH:mm format (00:00..23:59)')
      .nullable()
      .optional(),
    breakEnd: z
      .string()
      .regex(hhMmRegex, 'breakEnd must be in HH:mm format (00:00..23:59)')
      .nullable()
      .optional(),
  })
  .strict()
  .refine((day) => parseMinutes(day.startTime) < parseMinutes(day.endTime), {
    path: ['endTime'],
    message: 'startTime must be strictly earlier than endTime on the same day (BR-10)',
  })
  .superRefine((day, ctx) => {
    const hasStart = day.breakStart !== undefined && day.breakStart !== null;
    const hasEnd = day.breakEnd !== undefined && day.breakEnd !== null;
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: 'custom',
        path: [hasStart ? 'breakEnd' : 'breakStart'],
        message: 'breakStart and breakEnd must either both be set or both be null',
      });
      return;
    }
    if (hasStart && hasEnd && day.breakStart && day.breakEnd) {
      const bs = parseMinutes(day.breakStart);
      const be = parseMinutes(day.breakEnd);
      const ws = parseMinutes(day.startTime);
      const we = parseMinutes(day.endTime);
      if (bs >= be) {
        ctx.addIssue({
          code: 'custom',
          path: ['breakEnd'],
          message: 'breakStart must be strictly earlier than breakEnd',
        });
      }
      if (bs < ws || be > we) {
        ctx.addIssue({
          code: 'custom',
          path: ['breakStart'],
          message: 'Break must fall inside [startTime, endTime]',
        });
      }
    }
  });

export const replaceWorkingHoursBodySchema = z
  .object({
    days: z
      .array(workingDaySchema)
      .max(7)
      .superRefine((days, ctx) => {
        const seen = new Set<number>();
        for (let i = 0; i < days.length; i++) {
          const day = days[i];
          if (!day) continue;
          if (seen.has(day.dayOfWeek)) {
            ctx.addIssue({
              code: 'custom',
              path: [i, 'dayOfWeek'],
              message: `Duplicate dayOfWeek ${day.dayOfWeek} is not allowed`,
            });
          }
          seen.add(day.dayOfWeek);
        }
      }),
  })
  .strict();

export type ReplaceWorkingHoursBody = z.infer<typeof replaceWorkingHoursBodySchema>;

export const createStaffPasswordResetLinkBodySchema = z
  .object({
    sendEmail: z.boolean().optional().default(false),
  })
  .strict()
  .optional()
  .default({ sendEmail: false });

export type CreateStaffPasswordResetLinkBody = z.infer<
  typeof createStaffPasswordResetLinkBodySchema
>;
