// Must stay the first import so TZ is UTC before anything else runs.
import '../config/utc.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { disconnectPrisma } from '../lib/prisma.js';
import { startWorker } from './runner.js';

const worker = startWorker(env.WORKER_INTERVAL_MS);

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Worker shutting down');

  worker
    .stop()
    .then(() => disconnectPrisma())
    .then(() => {
      logger.info('Worker shutdown complete');
      process.exit(0);
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
