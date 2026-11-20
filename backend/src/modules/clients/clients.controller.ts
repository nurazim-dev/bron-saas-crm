import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import type {
  CreateClientInput,
  CreateClientTagInput,
  GetClientDetailQuery,
  ImportClientsExecuteInput,
  ImportClientsPreviewInput,
  ListClientsQuery,
  MergeClientsExecuteInput,
  MergeClientsPreviewInput,
  SetClientTagsInput,
  UpdateClientInput,
  UpdateClientTagInput,
} from './clients.schemas.js';
import { anonymizeClient, getClientDetail, listClients, updateClient } from './clients.service.js';
import {
  createClientManual,
  createClientTag,
  deleteClientTag,
  listClientTags,
  setClientTags,
  updateClientTag,
} from './clients-tags.service.js';
import { executeClientMerge, previewClientMerge } from './clients-merge.service.js';
import { executeClientImport, previewClientImport } from './clients-import.service.js';

export const listClientsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<ListClientsQuery>(req);
  const result = await listClients(actor, query);
  res.status(200).json({ data: result.items, meta: result.meta });
};

export const createClientController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateClientInput>(req);
  const data = await createClientManual(actor, body, extractAuditContext(req));
  res.status(201).json({ data });
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

export const listClientTagsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const data = await listClientTags(actor);
  res.status(200).json({ data });
};

export const createClientTagController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateClientTagInput>(req);
  const data = await createClientTag(actor, body, extractAuditContext(req));
  res.status(201).json({ data });
};

export const updateClientTagController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { tagId } = getValidatedParams<{ tagId: string }>(req);
  const body = getValidatedBody<UpdateClientTagInput>(req);
  const data = await updateClientTag(actor, tagId, body, extractAuditContext(req));
  res.status(200).json({ data });
};

export const deleteClientTagController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { tagId } = getValidatedParams<{ tagId: string }>(req);
  await deleteClientTag(actor, tagId, extractAuditContext(req));
  res.status(204).send();
};

export const setClientTagsController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<{ id: string }>(req);
  const body = getValidatedBody<SetClientTagsInput>(req);
  const data = await setClientTags(actor, id, body.tagIds, extractAuditContext(req));
  res.status(200).json({ data });
};

export const previewClientMergeController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<MergeClientsPreviewInput>(req);
  const data = await previewClientMerge(actor, body);
  res.status(200).json({ data });
};

export const executeClientMergeController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<MergeClientsExecuteInput>(req);
  const data = await executeClientMerge(actor, body, extractAuditContext(req));
  res.status(200).json({ data });
};

export const previewClientImportController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<ImportClientsPreviewInput>(req);
  const data = await previewClientImport(actor, body);
  res.status(200).json({ data });
};

export const executeClientImportController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<ImportClientsExecuteInput>(req);
  const data = await executeClientImport(actor, body, extractAuditContext(req));
  res.status(200).json({ data });
};
