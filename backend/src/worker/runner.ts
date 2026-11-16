import { env } from '../config/env.js';
import { now as clockNow } from '../lib/clock.js';
import { logger } from '../lib/logger.js';
import { prisma, withAdvisoryLock } from '../lib/prisma.js';
import {
  BILLING_NOTIFICATIONS_LOCK_KEY,
  runBillingNotificationsOnce,
} from './jobs/billing-notifications.job.js';
import {
  BILLING_STATE_SYNC_LOCK_KEY,
  runBillingStateSyncOnce,
} from './jobs/billing-state-sync.job.js';
import {
  OUTBOX_DISPATCHER_JOB_NAME,
  OUTBOX_DISPATCHER_LOCK_KEY,
  runOnce as runOutboxOnce,
} from './jobs/outbox-dispatcher.job.js';

export const WORKER_HEARTBEAT_NAME = 'main';

export interface WorkerHandle {
  stop(): Promise<void>;
}

async function writeHeartbeat(currentNow: Date): Promise<void> {
  await prisma.workerHeartbeat.upsert({
    where: { name: WORKER_HEARTBEAT_NAME },
    update: { beatAt: currentNow },
    create: { name: WORKER_HEARTBEAT_NAME, beatAt: currentNow },
  });
}

export async function runWorkerTick(currentNow: Date = clockNow()): Promise<void> {
  await writeHeartbeat(currentNow);

  const lockResult = await withAdvisoryLock(OUTBOX_DISPATCHER_LOCK_KEY, () =>
    runOutboxOnce({}, currentNow),
  );

  if (!lockResult.acquired) {
    logger.debug({ job: OUTBOX_DISPATCHER_JOB_NAME }, 'Skipped job: advisory lock held elsewhere');
    return;
  }

  const summary = lockResult.result;
  if (summary && summary.claimed > 0) {
    logger.info(
      { job: OUTBOX_DISPATCHER_JOB_NAME, ...summary },
      'Outbox dispatcher batch complete',
    );
  }

  await withAdvisoryLock(BILLING_STATE_SYNC_LOCK_KEY, () => runBillingStateSyncOnce(currentNow));
  await withAdvisoryLock(BILLING_NOTIFICATIONS_LOCK_KEY, () =>
    runBillingNotificationsOnce(currentNow),
  );
}

export function startWorker(intervalMs: number = env.WORKER_INTERVAL_MS): WorkerHandle {
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const triggerTick = () => {
    if (stopped || inFlight !== null) {
      return;
    }
    inFlight = runWorkerTick()
      .catch((err: unknown) => {
        logger.error({ err }, 'Worker tick failed');
      })
      .finally(() => {
        inFlight = null;
      });
  };

  // Run an immediate tick on startup so WorkerHeartbeat is fresh right away
  triggerTick();
  const timer = setInterval(triggerTick, intervalMs);
  timer.unref();

  logger.info({ intervalMs }, 'Background worker started');

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      if (inFlight) {
        await inFlight;
      }
      logger.info('Background worker stopped');
    },
  };
}
