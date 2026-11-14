// Must stay the first import: ESM evaluates imports in order, so TZ is UTC before anything else runs.
import './config/utc.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { startWorker } from './worker/runner.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();
const worker = env.WORKER_ENABLED ? startWorker(env.WORKER_INTERVAL_MS) : null;

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Backend listening');
});

server.on('error', (err) => {
  logger.fatal({ err }, 'HTTP server failed to start');
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err) {
      logger.error({ err }, 'Error while closing HTTP server');
      process.exit(1);
    }
    Promise.resolve(worker ? worker.stop() : undefined)
      .then(() => disconnectPrisma())
      .then(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      })
      .catch((dbErr: unknown) => {
        logger.error({ err: dbErr }, 'Error while disconnecting Prisma');
        process.exit(1);
      });
  });
  server.closeIdleConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
