import type { RequestHandler } from 'express';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedQuery } from '../../middleware/validate.js';
import type { GetAvailabilityQuery } from './availability.schemas.js';
import { getStaffAvailabilityForActor } from './availability.service.js';

export const getAvailabilityController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<GetAvailabilityQuery>(req);
  const availability = await getStaffAvailabilityForActor(actor, query);
  res.status(200).json({ data: availability });
};
