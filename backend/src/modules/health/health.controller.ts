import type { RequestHandler } from 'express';
import { getHealth } from './health.service.js';

export const healthController: RequestHandler = async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const health = await getHealth();
  const statusCode = health.database === 'up' ? 200 : 503;
  res.status(statusCode).json({ data: health });
};
