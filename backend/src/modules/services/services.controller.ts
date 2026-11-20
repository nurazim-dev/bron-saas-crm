import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedBody, getValidatedParams } from '../../middleware/validate.js';
import type {
  CreateServiceBody,
  CreateServicePackageBody,
  ServiceIdParams,
  UpdateServiceBody,
  UpdateServicePackageBody,
} from './services.schemas.js';
import {
  createServicePackageForCompany,
  deleteServicePackageForCompany,
  listServicePackagesForCompany,
  updateServicePackageForCompany,
} from './packages.service.js';
import {
  createServiceForCompany,
  deleteServiceForCompany,
  getServiceByIdForCompany,
  listServicesForCompany,
  updateServiceForCompany,
} from './services.service.js';

export const listServicesController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const services = await listServicesForCompany(actor.companyId, actor.role);
  res.status(200).json({ data: services });
};

export const getServiceController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<ServiceIdParams>(req);
  const service = await getServiceByIdForCompany(actor.companyId, id, actor.role);
  res.status(200).json({ data: service });
};

export const createServiceController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateServiceBody>(req);
  const service = await createServiceForCompany(actor.companyId, body);
  res.status(201).json({ data: service });
};

export const updateServiceController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<ServiceIdParams>(req);
  const body = getValidatedBody<UpdateServiceBody>(req);
  const service = await updateServiceForCompany(actor.companyId, id, body);
  res.status(200).json({ data: service });
};

export const deleteServiceController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<ServiceIdParams>(req);
  await deleteServiceForCompany(actor.companyId, id, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(204).send();
};

export const listServicePackagesController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const packages = await listServicePackagesForCompany(actor.companyId, actor.role);
  res.status(200).json({ data: packages });
};

export const createServicePackageController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<CreateServicePackageBody>(req);
  const pkg = await createServicePackageForCompany(actor.companyId, body, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(201).json({ data: pkg });
};

export const updateServicePackageController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<ServiceIdParams>(req);
  const body = getValidatedBody<UpdateServicePackageBody>(req);
  const pkg = await updateServicePackageForCompany(actor.companyId, id, body, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(200).json({ data: pkg });
};

export const deleteServicePackageController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const { id } = getValidatedParams<ServiceIdParams>(req);
  await deleteServicePackageForCompany(actor.companyId, id, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(204).send();
};
