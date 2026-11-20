import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate, getAuthActor } from '../../middleware/authenticate.js';
import { requireWritableSubscription } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { getValidatedBody, validate } from '../../middleware/validate.js';
import { type ApplyOnboardingBody, applyOnboardingBodySchema } from './onboarding.schemas.js';
import {
  applyOnboarding,
  dismissOnboarding,
  getOnboardingPresets,
  getOnboardingState,
  markOnboardingLinkShared,
} from './onboarding.service.js';

export const onboardingRouter = Router();
onboardingRouter.use(authenticate);
onboardingRouter.use(requireRole(Role.OWNER));

onboardingRouter.get('/', async (req, res) => {
  const actor = getAuthActor(req);
  const data = await getOnboardingState(actor.companyId);
  res.status(200).json({ data });
});

onboardingRouter.get('/presets', async (req, res) => {
  const actor = getAuthActor(req);
  const data = await getOnboardingPresets(actor.companyId);
  res.status(200).json({ data });
});

onboardingRouter.post(
  '/apply',
  requireWritableSubscription,
  validate({ body: applyOnboardingBodySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const body = getValidatedBody<ApplyOnboardingBody>(req);
    const data = await applyOnboarding(actor.companyId, actor.userId, body);
    res.status(200).json({ data });
  },
);

onboardingRouter.post('/dismiss', requireWritableSubscription, async (req, res) => {
  const actor = getAuthActor(req);
  const data = await dismissOnboarding(actor.companyId);
  res.status(200).json({ data });
});

onboardingRouter.post('/link-shared', requireWritableSubscription, async (req, res) => {
  const actor = getAuthActor(req);
  const data = await markOnboardingLinkShared(actor.companyId);
  res.status(200).json({ data });
});
