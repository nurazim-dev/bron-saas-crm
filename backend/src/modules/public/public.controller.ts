import type { RequestHandler } from 'express';
import {
  getValidatedBody,
  getValidatedParams,
  getValidatedQuery,
} from '../../middleware/validate.js';
import type {
  CompanySlugParams,
  CreatePublicAppointmentBody,
  GetPublicAvailabilityQuery,
} from './public.schemas.js';
import {
  createPublicAppointmentBySlug,
  getPublicAvailabilityBySlug,
  getPublicCompanyProfileBySlug,
} from './public.service.js';

export const getPublicCompanyController: RequestHandler = async (req, res) => {
  const { slug } = getValidatedParams<CompanySlugParams>(req);
  const profile = await getPublicCompanyProfileBySlug(slug);
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
