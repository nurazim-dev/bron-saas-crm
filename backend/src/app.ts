import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { Express } from 'express';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { globalRateLimiter } from './middleware/rate-limit.js';
import { REQUEST_ID_HEADER, requestId } from './middleware/request-id.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { companyRouter } from './modules/company/company.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { servicesRouter } from './modules/services/services.routes.js';
import { staffRouter } from './modules/staff/staff.routes.js';

export const API_PREFIX = '/api/v1';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
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
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/company`, companyRouter);
  app.use(`${API_PREFIX}/services`, servicesRouter);
  app.use(`${API_PREFIX}/staff`, staffRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
