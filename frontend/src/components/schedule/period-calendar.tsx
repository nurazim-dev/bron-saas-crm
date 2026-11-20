'use client';

import { Button } from '@/components/ui/button';
import {
  extractLocalDateAndTime,
  formatLocalDateRussian,
  formatTimeInCompanyTz,
} from '@/lib/datetime';
import { formatPriceKgs, ru } from '@/lib/i18n/ru';
import type { AppointmentDto } from '@/types/api';

interface Props {
  dates: string[];
  appointments: AppointmentDto[];
  timezone: string;
  selectedDate: string;
  month?: boolean;
  onDay: (date: string) => void;
  onAppointment: (appointment: AppointmentDto) => void;
}

export function PeriodCalendar({
  dates,
  appointments,
  timezone,
  selectedDate,
  month,
  onDay,
  onAppointment,
}: Props) {
  const byDate = new Map<string, AppointmentDto[]>();
  for (const appointment of appointments) {
    const date = extractLocalDateAndTime(appointment.startAt, timezone).date;
    const rows = byDate.get(date) ?? [];
    rows.push(appointment);
    byDate.set(date, rows);
  }
  return (
    <section
      aria-label={month ? 'Календарь месяца' : 'Записи по дням'}
      className="overflow-hidden rounded-xl border bg-card"
    >
      <div
        className={
          month
            ? 'grid grid-cols-1 md:grid-cols-7'
            : 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
        }
      >
        {dates.map((date) => {
          const items = byDate.get(date) ?? [];
          const outsideMonth = month && date.slice(0, 7) !== selectedDate.slice(0, 7);
          return (
            <section
              key={date}
              aria-label={formatLocalDateRussian(date, timezone)}
              className={`min-w-0 border-b p-3 md:border-r ${outsideMonth ? 'bg-muted/40' : ''}`}
            >
              <Button
                variant={date === selectedDate ? 'secondary' : 'ghost'}
                className="h-auto min-h-11 w-full justify-between gap-1 whitespace-normal px-2 text-left"
                onClick={() => onDay(date)}
                aria-label={`Открыть день: ${formatLocalDateRussian(date, timezone)}`}
              >
                <span className="text-xs capitalize">
                  {formatLocalDateRussian(date, timezone).replace(/ \d{4}$/, '')}
                </span>
                <span className="rounded-full bg-muted px-2 py-1 text-xs">{items.length}</span>
              </Button>
              <div className="mt-2 space-y-2">
                {items.length === 0 && (
                  <p className="px-2 py-3 text-xs text-muted-foreground">Нет записей</p>
                )}
                {items.map((appointment) => (
                  <button
                    key={appointment.id}
                    type="button"
                    onClick={() => onAppointment(appointment)}
                    className="block min-h-11 w-full space-y-1 rounded-lg border bg-background p-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="block font-semibold">
                      {formatTimeInCompanyTz(appointment.startAt, timezone)}–
                      {formatTimeInCompanyTz(appointment.endAt, timezone)}
                    </span>
                    <span className="block break-words font-medium">{appointment.clientName}</span>
                    <span className="block break-words text-muted-foreground">
                      {appointment.service.name} · {appointment.master.name}
                    </span>
                    <span className="block">{formatPriceKgs(appointment.price)}</span>
                    <span className="block text-muted-foreground">
                      {ru.appointmentStatuses[appointment.status]}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
