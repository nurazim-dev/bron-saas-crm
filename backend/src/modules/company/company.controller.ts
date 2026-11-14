import type { RequestHandler } from 'express';
import { extractAuditContext } from '../../lib/audit.js';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedBody } from '../../middleware/validate.js';
import type { UpdateCompanyBody } from './company.schemas.js';
import { getCompanyById, updateCompanyById } from './company.service.js';

export const getCompanyController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const company = await getCompanyById(actor.companyId);
  res.status(200).json({ data: company });
};

export const updateCompanyController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const body = getValidatedBody<UpdateCompanyBody>(req);
  const company = await updateCompanyById(actor.companyId, body, {
    actorId: actor.userId,
    context: extractAuditContext(req),
  });
  res.status(200).json({ data: company });
};
