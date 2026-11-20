import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { globalSearchController } from './search.controller.js';
import { globalSearchQuerySchema } from './search.schemas.js';

export const searchRouter = Router();

searchRouter.use(authenticate);
searchRouter.get('/', validate({ query: globalSearchQuerySchema }), globalSearchController);
