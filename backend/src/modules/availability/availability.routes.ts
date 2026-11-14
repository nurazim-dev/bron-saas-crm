import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { getAvailabilityController } from './availability.controller.js';
import { getAvailabilityQuerySchema } from './availability.schemas.js';

export const availabilityRouter = Router();

availabilityRouter.get(
  '/',
  authenticate,
  validate({ query: getAvailabilityQuerySchema }),
  getAvailabilityController,
);
