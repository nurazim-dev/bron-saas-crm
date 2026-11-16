import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import type { CreateTimeOffBody, ListTimeOffQuery, UpdateTimeOffBody } from './time-off.schemas.js';
import {
  createTimeOffForActor,
  deleteTimeOffForActor,
  listTimeOffForActor,
  updateTimeOffForActor,
} from './time-off.service.js';

export const listTimeOffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<ListTimeOffQuery>(req);
  const data = await listTimeOffForActor(actor, query);
  res.status(200).json({ data });
};

export const createTimeOffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateTimeOffBody>(req);
  const result = await createTimeOffForActor(actor, body, extractAuditContext(req));
  res.status(201).json({ data: result.timeOff, meta: { conflicts: result.conflicts } });
};

export const updateTimeOffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  const body = getValidatedBody<UpdateTimeOffBody>(req);
  const result = await updateTimeOffForActor(actor, id, body, extractAuditContext(req));
  res.status(200).json({ data: result.timeOff, meta: { conflicts: result.conflicts } });
};

export const deleteTimeOffController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  await deleteTimeOffForActor(actor, id, extractAuditContext(req));
  res.status(204).send();
};
