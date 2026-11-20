import { inviteStaff } from './invitations.service.js';
import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedBody, getValidatedParams } from '../../middleware/validate.js';
import { generateStaffPasswordResetLink } from '../auth/password-reset.service.js';
import {
  createStaffTelegramLinkCodeForCompany,
  unlinkStaffTelegramForCompany,
} from '../notifications/telegram-link.service.js';
import type {
  CreateStaffBody,
  CreateStaffPasswordResetLinkBody,
  InviteStaffBody,
  ReplaceStaffServicesBody,
  ReplaceWorkingHoursBody,
  StaffIdParams,
  UpdateStaffBody,
} from './staff.schemas.js';
import {
  createStaffForCompany,
  deleteStaffForCompany,
  getStaffByIdForActor,
  listStaffForCompany,
  replaceStaffServicesForCompany,
  replaceStaffWorkingHoursForCompany,
  updateStaffForCompany,
} from './staff.service.js';

export const listStaffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const staff = await listStaffForCompany(actor);
  res.status(200).json({ data: staff });
};

export const getStaffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  const staff = await getStaffByIdForActor(actor, id);
  res.status(200).json({ data: staff });
};

export const createStaffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateStaffBody>(req);
  const staff = await createStaffForCompany(actor.companyId, body, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(201).json({ data: staff });
};

export const updateStaffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  const body = getValidatedBody<UpdateStaffBody>(req);
  const staff = await updateStaffForCompany(actor.companyId, id, body, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(200).json({ data: staff });
};

export const deleteStaffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  await deleteStaffForCompany(actor.companyId, id, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(204).send();
};

export const replaceStaffServicesController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  const body = getValidatedBody<ReplaceStaffServicesBody>(req);
  const staff = await replaceStaffServicesForCompany(actor.companyId, id, body);
  res.status(200).json({ data: staff });
};

export const replaceStaffWorkingHoursController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  const body = getValidatedBody<ReplaceWorkingHoursBody>(req);
  const staff = await replaceStaffWorkingHoursForCompany(actor.companyId, id, body);
  res.status(200).json({ data: staff });
};

export const createStaffPasswordResetLinkController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  const body = getValidatedBody<CreateStaffPasswordResetLinkBody>(req);
  const result = await generateStaffPasswordResetLink(
    actor.companyId,
    actor.userId,
    id,
    body.sendEmail,
    extractAuditContext(req),
  );
  res.status(200).json({ data: result });
};

export const inviteStaffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const input = getValidatedBody<InviteStaffBody>(req);
  res.status(201).json({
    data: await inviteStaff(actor.companyId, actor.userId, input, extractAuditContext(req)),
  });
};

export const createStaffTelegramLinkCodeController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  const data = await createStaffTelegramLinkCodeForCompany(actor.companyId, id);
  res.status(200).json({ data });
};

export const unlinkStaffTelegramController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<StaffIdParams>(req);
  await unlinkStaffTelegramForCompany(actor.companyId, id);
  res.status(204).send();
};
