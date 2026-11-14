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

export const replaceStaffServicesBodySchema = z
  .object({
    serviceIds: z
      .array(z.uuid({ message: 'Each serviceId must be a valid UUID' }))
      .max(200)
      .transform((ids) => Array.from(new Set(ids))),
  })
  .strict();

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
  })
  .strict()
  .refine((day) => parseMinutes(day.startTime) < parseMinutes(day.endTime), {
    path: ['endTime'],
    message: 'startTime must be strictly earlier than endTime on the same day (BR-10)',
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
