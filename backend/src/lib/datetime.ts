import { DateTime, IANAZone } from 'luxon';
import { now as clockNow } from './clock.js';
import { AppError } from './errors.js';

export const LOCAL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const LOCAL_TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidIanaTimezone(timezone: string): boolean {
  return timezone.trim().length > 0 && IANAZone.isValidZone(timezone.trim());
}

function assertValidZone(timezone: string): void {
  if (!isValidIanaTimezone(timezone)) {
    throw new AppError('VALIDATION_ERROR', 400, `Invalid IANA timezone: ${timezone}`);
  }
}

function parseLocalDateDT(localDate: string, timezone: string): DateTime {
  assertValidZone(timezone);
  if (!LOCAL_DATE_REGEX.test(localDate)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Date must be in YYYY-MM-DD format');
  }
  const dt = DateTime.fromISO(localDate, { zone: timezone });
  if (!dt.isValid || dt.toFormat('yyyy-MM-dd') !== localDate) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid calendar date');
  }
  return dt;
}

/**
 * Converts a local calendar date (`YYYY-MM-DD`) and wall-clock time (`HH:mm`)
 * in the given IANA timezone into a UTC `Date` instant.
 */
export function localDateTimeToUtc(localDate: string, localTime: string, timezone: string): Date {
  assertValidZone(timezone);
  if (!LOCAL_DATE_REGEX.test(localDate)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Date must be in YYYY-MM-DD format');
  }
  if (!LOCAL_TIME_REGEX.test(localTime)) {
    throw new AppError('VALIDATION_ERROR', 400, 'Time must be in HH:mm format');
  }
  const dt = DateTime.fromISO(`${localDate}T${localTime}:00.000`, { zone: timezone });
  if (!dt.isValid || dt.toFormat('yyyy-MM-dd') !== localDate) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid local date or time');
  }
  return dt.toUTC().toJSDate();
}

/**
 * Converts a UTC `Date` (or ISO-8601 string) into local date/time components in the given IANA timezone.
 */
export function utcToLocalParts(
  utcInstant: Date | string,
  timezone: string,
): { date: string; time: string; dayOfWeek: number; dateTime: DateTime } {
  assertValidZone(timezone);
  const dt =
    typeof utcInstant === 'string'
      ? DateTime.fromISO(utcInstant, { zone: 'utc' }).setZone(timezone)
      : DateTime.fromJSDate(utcInstant, { zone: 'utc' }).setZone(timezone);

  if (!dt.isValid) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid UTC instant');
  }

  return {
    date: dt.toFormat('yyyy-MM-dd'),
    time: dt.toFormat('HH:mm'),
    dayOfWeek: dt.weekday,
    dateTime: dt,
  };
}

/**
 * Returns the ISO weekday (`1` = Monday ... `7` = Sunday) for a local calendar date (`YYYY-MM-DD`)
 * in the given IANA timezone.
 */
export function getIsoWeekdayOfLocalDate(localDate: string, timezone: string): number {
  return parseLocalDateDT(localDate, timezone).weekday;
}

/**
 * Returns the half-open UTC range `[startOfDayUtc, startOfNextDayUtc)` for a local calendar date
 * (`YYYY-MM-DD`) in the given IANA timezone (DST-safe).
 */
export function getLocalDayBoundsUtc(
  localDate: string,
  timezone: string,
): { startUtc: Date; endUtc: Date } {
  const startLocal = parseLocalDateDT(localDate, timezone).startOf('day');
  const nextDayLocal = startLocal.plus({ days: 1 }).startOf('day');
  return {
    startUtc: startLocal.toUTC().toJSDate(),
    endUtc: nextDayLocal.toUTC().toJSDate(),
  };
}

/**
 * Returns the current local calendar date (`YYYY-MM-DD`) in the given IANA timezone.
 */
export function getTodayLocalDate(timezone: string, now: Date = clockNow()): string {
  assertValidZone(timezone);
  return DateTime.fromJSDate(now, { zone: 'utc' }).setZone(timezone).toFormat('yyyy-MM-dd');
}

/**
 * Adds a number of calendar days to a local date (`YYYY-MM-DD`) in the given IANA timezone.
 */
export function addDaysToLocalDate(localDate: string, days: number, timezone: string): string {
  return parseLocalDateDT(localDate, timezone).plus({ days }).toFormat('yyyy-MM-dd');
}

/**
 * Adds minutes to a UTC `Date` instant and returns a new UTC `Date`.
 */
export function addMinutesUtc(instant: Date, minutes: number): Date {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).plus({ minutes }).toJSDate();
}

/**
 * Adds milliseconds to a UTC `Date` instant and returns a new UTC `Date`.
 */
export function addDurationMsUtc(instant: Date, durationMs: number): Date {
  return DateTime.fromMillis(instant.getTime() + durationMs, { zone: 'utc' }).toJSDate();
}

/**
 * Converts epoch milliseconds into a UTC `Date` instant.
 */
export function epochMsToUtcDate(epochMs: number): Date {
  return DateTime.fromMillis(epochMs, { zone: 'utc' }).toJSDate();
}

/**
 * Parses an ISO-8601 instant string and normalizes seconds and milliseconds to 0 (BR-2).
 */
export function parseNormalizedStartAtUtc(isoInstant: string): Date {
  const dt = DateTime.fromISO(isoInstant, { setZone: true });
  if (!dt.isValid) {
    throw new AppError('VALIDATION_ERROR', 400, 'startAt must be a valid ISO-8601 instant', [
      { path: 'startAt', message: 'startAt must be a valid ISO-8601 instant' },
    ]);
  }
  const normalized = dt.toUTC().set({ second: 0, millisecond: 0 });
  return normalized.toJSDate();
}
