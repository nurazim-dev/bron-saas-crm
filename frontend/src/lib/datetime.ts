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

export function formatLocalDateRussian(localDate: string, timezone = 'Asia/Bishkek'): string {
  const dt = DateTime.fromISO(localDate, { zone: timezone }).setLocale('ru');
  if (!dt.isValid) return localDate;
  return dt.toFormat('cccc, d MMMM yyyy');
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

export function getIsoWeekdayInTz(localDate: string, timezone = 'Asia/Bishkek'): number {
  const dt = DateTime.fromISO(localDate, { zone: timezone });
  return dt.isValid ? dt.weekday : 1;
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

export function getLocalDayUtcRange(
  localDate: string,
  timezone = 'Asia/Bishkek',
): { fromUtc: string; toUtc: string } {
  const start = DateTime.fromISO(localDate, { zone: timezone }).startOf('day');
  const end = start.plus({ days: 1 });
  return {
    fromUtc: start.toUTC().toISO() ?? new Date(start.toMillis()).toISOString(),
    toUtc: end.toUTC().toISO() ?? new Date(end.toMillis()).toISOString(),
  };
}

export function getLocalDateRangeUtc(
  fromLocalDate: string,
  toLocalDateInclusive: string,
  timezone = 'Asia/Bishkek',
): { fromUtc: string; toUtc: string } {
  const start = DateTime.fromISO(fromLocalDate, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(toLocalDateInclusive, { zone: timezone })
    .startOf('day')
    .plus({ days: 1 });
  return {
    fromUtc: start.toUTC().toISO() ?? new Date(start.toMillis()).toISOString(),
    toUtc: end.toUTC().toISO() ?? new Date(end.toMillis()).toISOString(),
  };
}

export function extractLocalDateAndTime(
  utcIso: string,
  timezone = 'Asia/Bishkek',
): { date: string; time: string } {
  const dt = DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) {
    return { date: getTodayLocalDateInTz(timezone), time: '10:00' };
  }
  return {
    date: dt.toFormat('yyyy-MM-dd'),
    time: dt.toFormat('HH:mm'),
  };
}

export function getMinutesSinceMidnightInTz(utcIso: string, timezone = 'Asia/Bishkek'): number {
  const dt = DateTime.fromISO(utcIso, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) return 0;
  return dt.hour * 60 + dt.minute;
}

export function getCurrentMinutesInTz(timezone = 'Asia/Bishkek'): number {
  const dt = DateTime.now().setZone(timezone);
  return dt.hour * 60 + dt.minute;
}

export type CalendarView = 'day' | 'week' | 'month';

export function getCalendarPeriod(localDate: string, view: CalendarView, timezone: string) {
  const selected = DateTime.fromISO(localDate, { zone: timezone }).startOf('day');
  const start =
    view === 'month'
      ? selected.startOf('month').startOf('week')
      : view === 'week'
        ? selected.startOf('week')
        : selected;
  const end =
    view === 'month'
      ? selected.endOf('month').endOf('week').startOf('day').plus({ days: 1 })
      : start.plus({ days: view === 'week' ? 7 : 1 });
  const dates: string[] = [];
  for (let day = start; day < end; day = day.plus({ days: 1 }))
    dates.push(day.toFormat('yyyy-MM-dd'));
  return {
    dates,
    fromUtc: start.toUTC().toISO() ?? '',
    toUtc: end.toUTC().toISO() ?? '',
    label:
      view === 'month'
        ? selected.setLocale('ru').toFormat('LLLL yyyy')
        : view === 'week'
          ? `${start.setLocale('ru').toFormat('d MMM')} – ${end.minus({ days: 1 }).setLocale('ru').toFormat('d MMM yyyy')}`
          : formatLocalDateRussian(localDate, timezone),
  };
}

export function shiftCalendarDate(
  localDate: string,
  view: CalendarView,
  direction: number,
  timezone: string,
): string {
  const date = DateTime.fromISO(localDate, { zone: timezone });
  return date
    .plus(
      view === 'month' ? { months: direction } : { days: direction * (view === 'week' ? 7 : 1) },
    )
    .toFormat('yyyy-MM-dd');
}
