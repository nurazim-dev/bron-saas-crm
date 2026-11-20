import { serviceIdsQuerySchema } from '../appointments/service-selection.js';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { LOCAL_DATE_REGEX } from '../../lib/datetime.js';

export const localDateQuerySchema = z
  .string()
  .trim()
  .refine((val) => LOCAL_DATE_REGEX.test(val), {
    message: 'date must be in YYYY-MM-DD format',
  })
  .refine(
    (val) => {
      const dt = DateTime.fromISO(val, { zone: 'utc' });
      return dt.isValid && dt.toFormat('yyyy-MM-dd') === val;
    },
    {
      message: 'date must be a valid calendar date',
    },
  );

export const getAvailabilityQuerySchema = z
  .object({
    serviceId: z.uuid({ message: 'serviceId must be a valid UUID' }).optional(),
    serviceIds: serviceIdsQuerySchema.optional(),
    packageId: z.uuid({ message: 'packageId must be a valid UUID' }).optional(),
    masterId: z.uuid({ message: 'masterId must be a valid UUID' }),
    date: localDateQuerySchema,
  })
  .superRefine((data, ctx) => {
    if (!data.serviceId && !data.packageId) {
      ctx.addIssue({
        code: 'custom',
        path: ['serviceId'],
        message: 'Either serviceId or packageId is required',
      });
    }
  });

export type GetAvailabilityQuery = z.infer<typeof getAvailabilityQuerySchema>;
