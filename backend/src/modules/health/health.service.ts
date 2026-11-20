import { env } from '../../config/env.js';
import { now as clockNow } from '../../lib/clock.js';
import { prisma } from '../../lib/prisma.js';
import { WORKER_HEARTBEAT_NAME } from '../../worker/runner.js';

const WORKER_STALE_THRESHOLD_MS = 2 * 60 * 1000;

export interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  worker: {
    status: 'up' | 'stale' | 'disabled';
    lastBeatAt: string | null;
  };
  uptimeSec: number;
  timestamp: string;
}

export async function getHealth(
  probeDb: () => Promise<unknown> = () => prisma.$queryRaw`SELECT 1`,
): Promise<HealthStatus> {
  const currentNow = clockNow();
  let database: 'up' | 'down' = 'up';
  try {
    await probeDb();
  } catch {
    database = 'down';
  }

  let workerStatus: 'up' | 'stale' | 'disabled' = env.WORKER_ENABLED ? 'stale' : 'disabled';
  let lastBeatAt: string | null = null;

  if (database === 'up') {
    const heartbeat = await prisma.workerHeartbeat.findUnique({
      where: { name: WORKER_HEARTBEAT_NAME },
    });
    if (heartbeat) {
      lastBeatAt = heartbeat.beatAt.toISOString();
      const ageMs = currentNow.getTime() - heartbeat.beatAt.getTime();
      workerStatus = ageMs > WORKER_STALE_THRESHOLD_MS ? 'stale' : 'up';
    } else if (env.WORKER_ENABLED) {
      workerStatus = 'stale';
    }
  }

  const isDegraded = database === 'down' || workerStatus === 'stale';

  return {
    status: isDegraded ? 'degraded' : 'ok',
    database,
    worker: {
      status: workerStatus,
      lastBeatAt,
    },
    uptimeSec: Math.round(process.uptime()),
    timestamp: currentNow.toISOString(),
  };
}
