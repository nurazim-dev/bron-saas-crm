import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedBody, getValidatedParams } from '../../middleware/validate.js';
import type {
  CreateStaffBody,
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
  const staff = await listStaffForCompany(actor.companyId);
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
