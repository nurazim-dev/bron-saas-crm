import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import { getPublicPlatformInfo } from '../platform/platform-settings.service.js';
import {
  cancelPublicManageAppointment,
  getPublicManageAppointment,
  getPublicManageAvailability,
  reschedulePublicManageAppointment,
} from './public-manage.service.js';
import type {
  CompanyDomainParams,
  CompanySlugParams,
  CreatePublicAppointmentBody,
  GetPublicAvailabilityQuery,
  ManageTokenParams,
  PublicManageAvailabilityQuery,
  PublicManageCancelBody,
  PublicManageRescheduleBody,
} from './public.schemas.js';
import {
  createPublicAppointmentBySlug,
  getPublicAvailabilityBySlug,
  getPublicCompanyProfileByDomain,
  getPublicCompanyProfileBySlug,
} from './public.service.js';

export const getPublicPlatformController: RequestHandler = async (_req, res) => {
  const data = await getPublicPlatformInfo();
  res.status(200).json({ data });
};

export const getPublicCompanyController: RequestHandler = async (req, res) => {
  const { slug } = getValidatedParams<CompanySlugParams>(req);
  const profile = await getPublicCompanyProfileBySlug(slug);
  res.status(200).json({ data: profile });
};

export const getPublicCompanyByDomainController: RequestHandler = async (req, res) => {
  const { domain } = getValidatedParams<CompanyDomainParams>(req);
  const profile = await getPublicCompanyProfileByDomain(domain);
  res.status(200).json({ data: profile });
};

export const getPublicAvailabilityController: RequestHandler = async (req, res) => {
  const { slug } = getValidatedParams<CompanySlugParams>(req);
  const query = getValidatedQuery<GetPublicAvailabilityQuery>(req);
  const availability = await getPublicAvailabilityBySlug(slug, query);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ data: availability });
};

export const createPublicAppointmentController: RequestHandler = async (req, res) => {
  const { slug } = getValidatedParams<CompanySlugParams>(req);
  const body = getValidatedBody<CreatePublicAppointmentBody>(req);
  const result = await createPublicAppointmentBySlug(slug, body);
  res.status(201).json({ data: result });
};

export const getPublicManageAppointmentController: RequestHandler = async (req, res) => {
  const { token } = getValidatedParams<ManageTokenParams>(req);
  const data = await getPublicManageAppointment(token);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ data });
};

export const getPublicManageAvailabilityController: RequestHandler = async (req, res) => {
  const { token } = getValidatedParams<ManageTokenParams>(req);
  const { date } = getValidatedQuery<PublicManageAvailabilityQuery>(req);
  const data = await getPublicManageAvailability(token, date);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ data });
};

export const cancelPublicManageAppointmentController: RequestHandler = async (req, res) => {
  const { token } = getValidatedParams<ManageTokenParams>(req);
  const body = getValidatedBody<PublicManageCancelBody>(req);
  const data = await cancelPublicManageAppointment(token, body, extractAuditContext(req));
  res.status(200).json({ data });
};

export const reschedulePublicManageAppointmentController: RequestHandler = async (req, res) => {
  const { token } = getValidatedParams<ManageTokenParams>(req);
  const body = getValidatedBody<PublicManageRescheduleBody>(req);
  const data = await reschedulePublicManageAppointment(token, body, extractAuditContext(req));
  res.status(200).json({ data });
};
