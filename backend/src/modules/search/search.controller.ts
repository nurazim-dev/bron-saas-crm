import type { RequestHandler } from 'express';
import { getAuthActor } from '../../middleware/authenticate.js';
import { getValidatedQuery } from '../../middleware/validate.js';
import type { GlobalSearchQuery } from './search.schemas.js';
import { runGlobalSearch } from './search.service.js';

export const globalSearchController: RequestHandler = async (req, res) => {
  const actor = getAuthActor(req);
  const query = getValidatedQuery<GlobalSearchQuery>(req);
  const data = await runGlobalSearch(actor, query);
  res.status(200).json({ data });
};
