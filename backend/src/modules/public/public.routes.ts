import { Router } from 'express';
import { publicBookingRateLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  createPublicAppointmentController,
  getPublicAvailabilityController,
  getPublicCompanyController,
  getPublicPlatformController,
} from './public.controller.js';
import {
  companySlugParamsSchema,
  createPublicAppointmentBodySchema,
  getPublicAvailabilityQuerySchema,
} from './public.schemas.js';

export const publicRouter = Router();

publicRouter.get('/platform', getPublicPlatformController);

publicRouter.get(
  '/companies/:slug',
  validate({ params: companySlugParamsSchema }),
  getPublicCompanyController,
);

publicRouter.get(
  '/companies/:slug/availability',
  validate({ params: companySlugParamsSchema, query: getPublicAvailabilityQuerySchema }),
  getPublicAvailabilityController,
);

publicRouter.post(
  '/companies/:slug/appointments',
  publicBookingRateLimiter,
  validate({ params: companySlugParamsSchema, body: createPublicAppointmentBodySchema }),
  createPublicAppointmentController,
);
