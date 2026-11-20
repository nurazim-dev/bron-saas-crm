import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { Express } from 'express';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger, scrubSensitiveUrl } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { globalRateLimiter } from './middleware/rate-limit.js';
import { REQUEST_ID_HEADER, requestId } from './middleware/request-id.js';
import { adminAuthRouter } from './modules/admin/admin-auth.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { analyticsRouter, exportRouter } from './modules/analytics/analytics.routes.js';
import { appointmentsRouter } from './modules/appointments/appointments.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { availabilityRouter } from './modules/availability/availability.routes.js';
import { billingRouter } from './modules/billing/billing.routes.js';
import { clientsRouter } from './modules/clients/clients.routes.js';
import { companyRouter } from './modules/company/company.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import {
  meNotificationsRouter,
  remindersRouter,
  telegramWebhookRouter,
} from './modules/notifications/phase20.routes.js';
import { registerReminderOutboxHooks } from './modules/notifications/reminders.service.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { paymentsRouter } from './modules/payments/payments.routes.js';
import { publicRouter } from './modules/public/public.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { servicesRouter } from './modules/services/services.routes.js';
import { staffRouter } from './modules/staff/staff.routes.js';
import { mediaRouter, publicMediaRouter } from './modules/media/media.routes.js';
import { timeOffRouter } from './modules/time-off/time-off.routes.js';

export const API_PREFIX = '/api/v1';

export function createApp(): Express {
  registerReminderOutboxHooks();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req: { id?: unknown; method?: string; url?: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: scrubSensitiveUrl(req.url),
          remoteAddress: req.remoteAddress,
        }),
      },
      genReqId: (_req, res) => {
        const id = res.getHeader(REQUEST_ID_HEADER);
        return typeof id === 'string' ? id : 'unknown';
      },
      customLogLevel: (_req, res, err) => {
        if (err !== undefined || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );
  app.use(helmet());
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const path = req.path;
    if (
      path.startsWith(`${API_PREFIX}/auth`) ||
      path.startsWith(`${API_PREFIX}/admin`) ||
      path.startsWith(`${API_PREFIX}/public/manage`) ||
      path.startsWith(`${API_PREFIX}/clients`) ||
      path.startsWith(`${API_PREFIX}/me`)
    ) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: [REQUEST_ID_HEADER],
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '100kb' }));
  app.use(globalRateLimiter);

  app.use(`${API_PREFIX}/health`, healthRouter);
  app.use(`${API_PREFIX}/admin/auth`, adminAuthRouter);
  app.use(`${API_PREFIX}/admin`, adminRouter);
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/billing`, billingRouter);
  app.use(`${API_PREFIX}/payments`, paymentsRouter);
  app.use(`${API_PREFIX}/clients`, clientsRouter);
  app.use(`${API_PREFIX}/company`, companyRouter);
  app.use(`${API_PREFIX}/services`, servicesRouter);
  app.use(`${API_PREFIX}/staff`, mediaRouter);
  app.use(`${API_PREFIX}/staff`, staffRouter);
  app.use(`${API_PREFIX}/time-off`, timeOffRouter);
  app.use(`${API_PREFIX}/appointments`, appointmentsRouter);
  app.use(`${API_PREFIX}/availability`, availabilityRouter);
  app.use(`${API_PREFIX}/notifications`, notificationsRouter);
  app.use(`${API_PREFIX}/me`, meNotificationsRouter);
  app.use(`${API_PREFIX}/telegram`, telegramWebhookRouter);
  app.use(`${API_PREFIX}/reminders`, remindersRouter);
  app.use(`${API_PREFIX}/analytics`, analyticsRouter);
  app.use(`${API_PREFIX}/export`, exportRouter);
  app.use(`${API_PREFIX}/search`, searchRouter);
  app.use(`${API_PREFIX}/onboarding`, onboardingRouter);
  app.use(`${API_PREFIX}/public`, publicMediaRouter);
  app.use(`${API_PREFIX}/public`, publicRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
