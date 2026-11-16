import { Router } from 'express';
import { Role } from '../../generated/prisma/client.js';
import { authenticate, getAuthActor } from '../../middleware/authenticate.js';
import { requireFeature } from '../../middleware/billing.js';
import { requireRole } from '../../middleware/require-role.js';
import { getValidatedQuery, validate } from '../../middleware/validate.js';
import {
  type AnalyticsRangeQuery,
  analyticsRangeQuerySchema,
  type AnalyticsTimeseriesQuery,
  analyticsTimeseriesQuerySchema,
} from './analytics.schemas.js';
import {
  exportAppointmentsCsv,
  getAnalyticsHeatmap,
  getAnalyticsMasters,
  getAnalyticsServices,
  getAnalyticsSummary,
  getAnalyticsTimeseries,
} from './analytics.service.js';

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

// MASTER own summary (ungated by featureAnalytics, forced to actor.userId)
analyticsRouter.get(
  '/me/summary',
  requireRole(Role.OWNER, Role.MASTER),
  validate({ query: analyticsRangeQuerySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const query = getValidatedQuery<AnalyticsRangeQuery>(req);
    const data = await getAnalyticsSummary(actor.companyId, {
      ...query,
      masterId: actor.userId,
    });
    res.status(200).json({ data });
  },
);

analyticsRouter.get(
  '/summary',
  requireRole(Role.OWNER),
  requireFeature('analytics'),
  validate({ query: analyticsRangeQuerySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const query = getValidatedQuery<AnalyticsRangeQuery>(req);
    const data = await getAnalyticsSummary(actor.companyId, query);
    res.status(200).json({ data });
  },
);

analyticsRouter.get(
  '/timeseries',
  requireRole(Role.OWNER),
  requireFeature('analytics'),
  validate({ query: analyticsTimeseriesQuerySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const query = getValidatedQuery<AnalyticsTimeseriesQuery>(req);
    const data = await getAnalyticsTimeseries(actor.companyId, query);
    res.status(200).json({ data });
  },
);

analyticsRouter.get(
  '/services',
  requireRole(Role.OWNER),
  requireFeature('analytics'),
  validate({ query: analyticsRangeQuerySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const query = getValidatedQuery<AnalyticsRangeQuery>(req);
    const data = await getAnalyticsServices(actor.companyId, query);
    res.status(200).json({ data });
  },
);

analyticsRouter.get(
  '/masters',
  requireRole(Role.OWNER),
  requireFeature('analytics'),
  validate({ query: analyticsRangeQuerySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const query = getValidatedQuery<AnalyticsRangeQuery>(req);
    const data = await getAnalyticsMasters(actor.companyId, query);
    res.status(200).json({ data });
  },
);

analyticsRouter.get(
  '/heatmap',
  requireRole(Role.OWNER),
  requireFeature('analytics'),
  validate({ query: analyticsRangeQuerySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const query = getValidatedQuery<AnalyticsRangeQuery>(req);
    const data = await getAnalyticsHeatmap(actor.companyId, query);
    res.status(200).json({ data });
  },
);

export const exportRouter = Router();
exportRouter.use(authenticate);

exportRouter.get(
  '/appointments.csv',
  requireRole(Role.OWNER),
  validate({ query: analyticsRangeQuerySchema }),
  async (req, res) => {
    const actor = getAuthActor(req);
    const query = getValidatedQuery<AnalyticsRangeQuery>(req);
    const csv = await exportAppointmentsCsv(actor.companyId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="appointments-${query.from}-to-${query.to}.csv"`,
    );
    res.status(200).send(csv);
  },
);
