import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import type {
  GetClientDetailQuery,
  ListClientsQuery,
  UpdateClientInput,
} from './clients.schemas.js';
import { anonymizeClient, getClientDetail, listClients, updateClient } from './clients.service.js';

export const listClientsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<ListClientsQuery>(req);
  const result = await listClients(actor, query);
  res.status(200).json({ data: result.items, meta: result.meta });
};

export const getClientDetailController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  const query = getValidatedQuery<GetClientDetailQuery>(req);
  const result = await getClientDetail(actor, id, query);
  res.status(200).json({ data: result });
};

export const updateClientController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  const body = getValidatedBody<UpdateClientInput>(req);
  const data = await updateClient(actor, id, body, extractAuditContext(req));
  res.status(200).json({ data });
};

export const anonymizeClientController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  const data = await anonymizeClient(actor, id, extractAuditContext(req));
  res.status(200).json({ data });
};
