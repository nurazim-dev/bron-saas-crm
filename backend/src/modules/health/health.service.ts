import { prisma } from '../../lib/prisma.js';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSec: number;
  timestamp: string;
}

export async function getHealth(
  probeDb: () => Promise<unknown> = () => prisma.$queryRaw`SELECT 1`,
): Promise<HealthStatus> {
  let database: 'up' | 'down' = 'up';
  try {
    await probeDb();
  } catch {
    database = 'down';
  }

  return {
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}
