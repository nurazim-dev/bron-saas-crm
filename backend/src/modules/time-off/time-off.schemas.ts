import { z } from 'zod';

const timeOffKindEnum = z.enum(['VACATION', 'SICK_LEAVE', 'OTHER']);
const localDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const timeOffIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listTimeOffQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const createTimeOffBodySchema = z
  .object({
    userId: z.string().uuid().optional(),
    kind: timeOffKindEnum,
    allDay: z.boolean().optional().default(false),
    startDate: z.string().regex(localDateRegex, 'startDate must be YYYY-MM-DD').optional(),
    endDate: z.string().regex(localDateRegex, 'endDate must be YYYY-MM-DD').optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.allDay) {
      if (!data.startDate || !data.endDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['startDate'],
          message: 'startDate and endDate are required when allDay is true',
        });
      }
    } else if (!data.startAt || !data.endAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['startAt'],
        message: 'startAt and endAt are required when allDay is false',
      });
    }
  });

export const updateTimeOffBodySchema = z
  .object({
    kind: timeOffKindEnum.optional(),
    allDay: z.boolean().optional(),
    startDate: z.string().regex(localDateRegex, 'startDate must be YYYY-MM-DD').optional(),
    endDate: z.string().regex(localDateRegex, 'endDate must be YYYY-MM-DD').optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export type ListTimeOffQuery = z.infer<typeof listTimeOffQuerySchema>;
export type CreateTimeOffBody = z.infer<typeof createTimeOffBodySchema>;
export type UpdateTimeOffBody = z.infer<typeof updateTimeOffBodySchema>;
