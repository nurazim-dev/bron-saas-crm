import { DateTime } from 'luxon';
import { z } from 'zod';
import { localDateQuerySchema } from '../availability/availability.schemas.js';

const MAX_ANALYTICS_RANGE_DAYS = 366;

const baseRangeSchema = z.object({
  from: localDateQuerySchema,
  to: localDateQuerySchema,
  masterId: z.uuid({ message: 'masterId must be a valid UUID' }).optional(),
});

function validateRange(data: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const fromDt = DateTime.fromISO(data.from, { zone: 'utc' });
  const toDt = DateTime.fromISO(data.to, { zone: 'utc' });
  if (!fromDt.isValid || !toDt.isValid) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'Invalid date range' });
    return;
  }
  if (toDt < fromDt) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: '"to" must be on or after "from"',
    });
    return;
  }
  const days = Math.round(toDt.diff(fromDt, 'days').days) + 1;
  if (days > MAX_ANALYTICS_RANGE_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Date range must not exceed ${MAX_ANALYTICS_RANGE_DAYS} days`,
    });
  }
}

export const analyticsRangeQuerySchema = baseRangeSchema.superRefine(validateRange);
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

export const analyticsTimeseriesQuerySchema = baseRangeSchema
  .extend({
    granularity: z.enum(['day', 'week', 'month']).optional().default('day'),
  })
  .superRefine(validateRange);
export type AnalyticsTimeseriesQuery = z.infer<typeof analyticsTimeseriesQuerySchema>;
