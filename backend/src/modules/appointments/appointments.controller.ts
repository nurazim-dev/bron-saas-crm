import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import { markManualReminderSent } from '../notifications/reminders.service.js';
import type {
  AppointmentIdParams,
  CreateAppointmentBody,
  ListAppointmentsQuery,
  PrepaymentActionBody,
  UpdateAppointmentBody,
  UpdateAppointmentStatusBody,
} from './appointments.schemas.js';
import {
  applyPrepaymentAction,
  changeAppointmentStatusForActor,
  createStaffAppointmentForActor,
  deleteAppointmentForCompany,
  getAppointmentByIdForActor,
  listAppointmentsForActor,
  updateAppointmentForActor,
} from './appointments.service.js';

export const listAppointmentsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<ListAppointmentsQuery>(req);
  const result = await listAppointmentsForActor(actor, query);
  res.status(200).json(result);
};

export const getAppointmentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<AppointmentIdParams>(req);
  const appointment = await getAppointmentByIdForActor(actor, id);
  res.status(200).json({ data: appointment });
};

export const createAppointmentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateAppointmentBody>(req);
  const appointment = await createStaffAppointmentForActor(actor, body);
  res.status(201).json({ data: appointment });
};

export const updateAppointmentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<AppointmentIdParams>(req);
  const body = getValidatedBody<UpdateAppointmentBody>(req);
  const appointment = await updateAppointmentForActor(actor, id, body);
  res.status(200).json({ data: appointment });
};

export const changeAppointmentStatusController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<AppointmentIdParams>(req);
  const body = getValidatedBody<UpdateAppointmentStatusBody>(req);
  const appointment = await changeAppointmentStatusForActor(actor, id, body);
  res.status(200).json({ data: appointment });
};

export const deleteAppointmentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<AppointmentIdParams>(req);
  await deleteAppointmentForCompany(actor.companyId, id, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(204).send();
};

export const markReminderSentController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<AppointmentIdParams>(req);
  const data = await markManualReminderSent(actor, id);
  res.status(200).json({ data });
};

export const prepaymentActionController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<AppointmentIdParams>(req);
  const { action } = getValidatedBody<PrepaymentActionBody>(req);
  const data = await applyPrepaymentAction(actor, id, action, extractAuditContext(req));
  res.status(200).json({ data });
};
