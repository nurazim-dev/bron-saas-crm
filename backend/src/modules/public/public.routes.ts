import { Router } from 'express';
import {
  publicBookingRateLimiter,
  publicManageReadRateLimiter,
  publicManageWriteRateLimiter,
} from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  cancelPublicManageAppointmentController,
  createPublicAppointmentController,
  getPublicAvailabilityController,
  getPublicCompanyController,
  getPublicManageAppointmentController,
  getPublicManageAvailabilityController,
  getPublicPlatformController,
  reschedulePublicManageAppointmentController,
} from './public.controller.js';
import {
  companySlugParamsSchema,
  createPublicAppointmentBodySchema,
  getPublicAvailabilityQuerySchema,
  manageTokenParamsSchema,
  publicManageAvailabilityQuerySchema,
  publicManageCancelBodySchema,
  publicManageRescheduleBodySchema,
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

publicRouter.get(
  '/manage/:token',
  publicManageReadRateLimiter,
  validate({ params: manageTokenParamsSchema }),
  getPublicManageAppointmentController,
);

publicRouter.get(
  '/manage/:token/availability',
  publicManageReadRateLimiter,
  validate({ params: manageTokenParamsSchema, query: publicManageAvailabilityQuerySchema }),
  getPublicManageAvailabilityController,
);

publicRouter.post(
  '/manage/:token/cancel',
  publicManageWriteRateLimiter,
  validate({ params: manageTokenParamsSchema, body: publicManageCancelBodySchema }),
  cancelPublicManageAppointmentController,
);

publicRouter.post(
  '/manage/:token/reschedule',
  publicManageWriteRateLimiter,
  validate({ params: manageTokenParamsSchema, body: publicManageRescheduleBodySchema }),
  reschedulePublicManageAppointmentController,
);
