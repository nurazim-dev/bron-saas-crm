import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requireRole } from '../../middleware/require-role.js';
import { validate } from '../../middleware/validate.js';
import {
  changeAppointmentStatusController,
  createAppointmentController,
  deleteAppointmentController,
  getAppointmentController,
  listAppointmentsController,
  updateAppointmentController,
} from './appointments.controller.js';
import {
  appointmentIdParamsSchema,
  createAppointmentBodySchema,
  listAppointmentsQuerySchema,
  updateAppointmentBodySchema,
  updateAppointmentStatusBodySchema,
} from './appointments.schemas.js';

export const appointmentsRouter = Router();

appointmentsRouter.get(
  '/',
  authenticate,
  validate({ query: listAppointmentsQuerySchema }),
  listAppointmentsController,
);

appointmentsRouter.post(
  '/',
  authenticate,
  validate({ body: createAppointmentBodySchema }),
  createAppointmentController,
);

appointmentsRouter.get(
  '/:id',
  authenticate,
  validate({ params: appointmentIdParamsSchema }),
  getAppointmentController,
);

appointmentsRouter.patch(
  '/:id',
  authenticate,
  validate({ params: appointmentIdParamsSchema, body: updateAppointmentBodySchema }),
  updateAppointmentController,
);

appointmentsRouter.post(
  '/:id/status',
  authenticate,
  validate({ params: appointmentIdParamsSchema, body: updateAppointmentStatusBodySchema }),
  changeAppointmentStatusController,
);

appointmentsRouter.delete(
  '/:id',
  authenticate,
  requireRole(Role.OWNER),
  validate({ params: appointmentIdParamsSchema }),
  deleteAppointmentController,
);
