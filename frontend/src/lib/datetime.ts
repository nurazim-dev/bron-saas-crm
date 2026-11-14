import { DateTime } from 'luxon';

export function formatTimeInCompanyTz(
  utcIsoOrDate: string | Date,
  timezone = 'Asia/Bishkek',
): string {
  const dt =
    typeof utcIsoOrDate === 'string'
      ? DateTime.fromISO(utcIsoOrDate, { zone: 'utc' }).setZone(timezone)
      : DateTime.fromJSDate(utcIsoOrDate, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) return '';
  return dt.toFormat('HH:mm');
}

export function formatDateInCompanyTz(
  utcIsoOrDate: string | Date,
  timezone = 'Asia/Bishkek',
): string {
  const dt =
    typeof utcIsoOrDate === 'string'
      ? DateTime.fromISO(utcIsoOrDate, { zone: 'utc' }).setZone(timezone)
      : DateTime.fromJSDate(utcIsoOrDate, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) return '';
  return dt.setLocale('ru').toFormat('d MMMM yyyy');
}

export function formatDateTimeInCompanyTz(
  utcIsoOrDate: string | Date,
  timezone = 'Asia/Bishkek',
): string {
  const dt =
    typeof utcIsoOrDate === 'string'
      ? DateTime.fromISO(utcIsoOrDate, { zone: 'utc' }).setZone(timezone)
      : DateTime.fromJSDate(utcIsoOrDate, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) return '';
  return dt.setLocale('ru').toFormat('d MMM yyyy, HH:mm');
}

export function getTodayLocalDateInTz(timezone = 'Asia/Bishkek'): string {
  return DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd');
}

export function addDaysToLocalDateInTz(
  localDate: string,
  days: number,
  timezone = 'Asia/Bishkek',
): string {
  const dt = DateTime.fromISO(localDate, { zone: timezone });
  if (!dt.isValid) return localDate;
  return dt.plus({ days }).toFormat('yyyy-MM-dd');
}

export function localDateTimeToUtcIso(
  localDate: string,
  localTime: string,
  timezone = 'Asia/Bishkek',
): string {
  const dt = DateTime.fromISO(`${localDate}T${localTime}:00.000`, { zone: timezone });
  if (!dt.isValid) {
    return new Date().toISOString();
  }
  return dt.toUTC().toISO() ?? new Date(dt.toMillis()).toISOString();
}
