import { now as clockNow } from '../../lib/clock.js';
import {
  type DispatcherDeps,
  type DispatcherRunSummary,
  runOutboxDispatcherOnce,
} from '../../modules/notifications/dispatcher.service.js';

export const OUTBOX_DISPATCHER_JOB_NAME = 'outbox-dispatcher';
export const OUTBOX_DISPATCHER_LOCK_KEY = 100_001;

export async function runOnce(
  deps: DispatcherDeps = {},
  currentNow: Date = clockNow(),
): Promise<DispatcherRunSummary> {
  return runOutboxDispatcherOnce(deps, currentNow);
}
