import type { RequestHandler } from 'express';
import { getHealth } from './health.service.js';

export const healthController: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ data: getHealth() });
};
