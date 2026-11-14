import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.js';
import {
  addDaysToLocalDate,
  getIsoWeekdayOfLocalDate,
  getLocalDayBoundsUtc,
  getTodayLocalDate,
  isValidIanaTimezone,
  localDateTimeToUtc,
  parseNormalizedStartAtUtc,
  utcToLocalParts,
} from '../../src/lib/datetime.js';

describe('datetime helpers (UTC & IANA timezones)', () => {
  it('validates IANA timezones accurately', () => {
    expect(isValidIanaTimezone('Asia/Bishkek')).toBe(true);
    expect(isValidIanaTimezone('Europe/Berlin')).toBe(true);
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('')).toBe(false);
    expect(isValidIanaTimezone('Mars/Phobos')).toBe(false);
  });

  it('converts 10:00 on 2026-11-20 in Asia/Bishkek to 2026-11-20T04:00:00.000Z and round-trips (§3.4 mandatory test)', () => {
    const utc = localDateTimeToUtc('2026-11-20', '10:00', 'Asia/Bishkek');
    expect(utc.toISOString()).toBe('2026-11-20T04:00:00.000Z');

    const local = utcToLocalParts(utc, 'Asia/Bishkek');
    expect(local.date).toBe('2026-11-20');
    expect(local.time).toBe('10:00');
    expect(local.dayOfWeek).toBe(5); // Friday
    expect(getIsoWeekdayOfLocalDate('2026-11-20', 'Asia/Bishkek')).toBe(5);
  });

  it('computes local day bounds in Asia/Bishkek', () => {
    const bounds = getLocalDayBoundsUtc('2026-11-20', 'Asia/Bishkek');
    expect(bounds.startUtc.toISOString()).toBe('2026-11-19T18:00:00.000Z');
    expect(bounds.endUtc.toISOString()).toBe('2026-11-20T18:00:00.000Z');
  });

  it('handles DST transitions accurately in a DST zone (Europe/Berlin)', () => {
    // Before DST spring-forward (CET = UTC+1)
    const winter = localDateTimeToUtc('2026-01-15', '10:00', 'Europe/Berlin');
    expect(winter.toISOString()).toBe('2026-01-15T09:00:00.000Z');

    // After DST spring-forward (CEST = UTC+2)
    const summer = localDateTimeToUtc('2026-07-15', '10:00', 'Europe/Berlin');
    expect(summer.toISOString()).toBe('2026-07-15T08:00:00.000Z');

    // Spring-forward day in Europe/Berlin: 2026-03-29 (23-hour local day)
    const springBounds = getLocalDayBoundsUtc('2026-03-29', 'Europe/Berlin');
    expect(springBounds.startUtc.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(springBounds.endUtc.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect((springBounds.endUtc.getTime() - springBounds.startUtc.getTime()) / 3_600_000).toBe(23);

    // Fall-back day in Europe/Berlin: 2026-10-25 (25-hour local day)
    const fallBounds = getLocalDayBoundsUtc('2026-10-25', 'Europe/Berlin');
    expect(fallBounds.startUtc.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(fallBounds.endUtc.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect((fallBounds.endUtc.getTime() - fallBounds.startUtc.getTime()) / 3_600_000).toBe(25);
  });

  it('normalizes seconds and milliseconds to 0 in parseNormalizedStartAtUtc (BR-2)', () => {
    const normalized = parseNormalizedStartAtUtc('2026-11-20T10:30:45.678+06:00');
    expect(normalized.toISOString()).toBe('2026-11-20T04:30:00.000Z');
  });

  it('computes today local date and adds days across month boundaries', () => {
    const refUtc = new Date('2026-11-20T20:30:00.000Z'); // 2026-11-21 02:30 in Asia/Bishkek
    expect(getTodayLocalDate('Asia/Bishkek', refUtc)).toBe('2026-11-21');
    expect(addDaysToLocalDate('2026-11-28', 5, 'Asia/Bishkek')).toBe('2026-12-03');
  });

  it('rejects invalid dates, times, and timezones with AppError VALIDATION_ERROR', () => {
    expect(() => localDateTimeToUtc('2026-02-30', '10:00', 'Asia/Bishkek')).toThrow(AppError);
    expect(() => localDateTimeToUtc('2026-11-20', '25:00', 'Asia/Bishkek')).toThrow(AppError);
    expect(() => localDateTimeToUtc('2026-11-20', '10:00', 'Invalid/Zone')).toThrow(AppError);
    expect(() => parseNormalizedStartAtUtc('not-a-date')).toThrow(AppError);
  });
});
