'use client';

import {
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppointmentDetailsModal,
  AppointmentFormDialog,
} from '@/components/appointments/appointment-dialogs';
import { PeriodCalendar } from '@/components/schedule/period-calendar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { listCalendarAppointments, updateAppointment } from '@/lib/api/appointments.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { listServices } from '@/lib/api/services.api';
import { listVisibleStaffForRole } from '@/lib/api/staff.api';
import { listTimeOff, type TimeOffDto } from '@/lib/api/time-off.api';
import {
  localDateTimeToUtcIso,
  getCalendarPeriod,
  shiftCalendarDate,
  type CalendarView,
  formatTimeInCompanyTz,
  getCurrentMinutesInTz,
  getIsoWeekdayInTz,
  getLocalDayUtcRange,
  getMinutesSinceMidnightInTz,
  getTodayLocalDateInTz,
} from '@/lib/datetime';
import { formatPriceKgs, ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';
import type { AppointmentDto, AppointmentStatus, ServiceDto, StaffDto } from '@/types/api';

const SLOT_STEP_MIN = 30;
const ROW_HEIGHT_PX = 52;
const PX_PER_MINUTE = ROW_HEIGHT_PX / SLOT_STEP_MIN;

function parseHhMmToMinutes(hhMm: string): number {
  const [h, m] = hhMm.split(':');
  return Number(h) * 60 + Number(m);
}

const BLOCK_STYLES: Record<AppointmentStatus, string> = {
  SCHEDULED:
    'border-emerald-600/40 bg-emerald-500/15 text-emerald-950 hover:bg-emerald-500/25 dark:text-emerald-100',
  CONFIRMED:
    'border-indigo-600/40 bg-indigo-500/15 text-indigo-950 hover:bg-indigo-500/25 dark:text-indigo-100',
  IN_PROGRESS:
    'border-violet-600/40 bg-violet-500/15 text-violet-950 hover:bg-violet-500/25 dark:text-violet-100',
  COMPLETED: 'border-sky-600/40 bg-sky-500/15 text-sky-950 hover:bg-sky-500/25 dark:text-sky-100',
  CANCELLED:
    'border-neutral-400/40 bg-neutral-500/10 text-muted-foreground line-through opacity-70 hover:opacity-90',
  NO_SHOW:
    'border-amber-600/40 bg-amber-500/15 text-amber-950 hover:bg-amber-500/25 dark:text-amber-100',
};

export default function SchedulePage() {
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const timezone = company?.timezone ?? 'Asia/Bishkek';

  const dragId = useRef<string | null>(null);
  const [move, setMove] = useState<{
    appointment: AppointmentDto;
    master: StaffDto;
    time: string;
    date: string;
  } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveNotice, setMoveNotice] = useState('');
  const [selectedDate, setSelectedDate] = useState(() => getTodayLocalDateInTz(timezone));
  const [view, setView] = useState<CalendarView>('day');
  const [selectedServiceFilter, setSelectedServiceFilter] = useState('ALL');
  const period = useMemo(
    () => getCalendarPeriod(selectedDate, view, timezone),
    [selectedDate, view, timezone],
  );
  const [selectedMasterFilter, setSelectedMasterFilter] = useState<string>('ALL');

  const [staffList, setStaffList] = useState<StaffDto[]>([]);
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [appointments, setAppointments] = useState<AppointmentDto[]>([]);
  const [timeOffs, setTimeOffs] = useState<TimeOffDto[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Current time indicator state
  const [currentMinutes, setCurrentMinutes] = useState(() => getCurrentMinutesInTz(timezone));

  // Details & Form dialogs state
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentDto | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentDto | null>(null);
  const [prefillMasterId, setPrefillMasterId] = useState<string | undefined>(undefined);
  const [prefillTime, setPrefillTime] = useState<string | undefined>(undefined);

  // Load staff, services, and day appointments
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const userRole = user.role;
    let cancelled = false;
    const controller = new AbortController();

    async function loadData() {
      try {
        const { fromUtc, toUtc } = period;
        const [staffData, servicesData, apptsRes, timeOffData] = await Promise.all([
          listVisibleStaffForRole(userId, userRole),
          listServices(),
          listCalendarAppointments({ from: fromUtc, to: toUtc }, controller.signal),
          listTimeOff({ from: fromUtc, to: toUtc }),
        ]);

        if (!cancelled) {
          setStaffList(staffData);
          setServices(servicesData);
          setAppointments(apptsRes);
          setTimeOffs(timeOffData);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(getApiErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey, period, user]);

  // 60s auto-refresh when tab is visible + update current time indicator
  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentMinutes(getCurrentMinutesInTz(timezone));
      if (document.visibilityState === 'visible') {
        setIsRefreshing(true);
        setReloadKey((k) => k + 1);
      }
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [timezone]);

  const bookableMasters = useMemo(
    () => staffList.filter((m) => m.isActive && m.isBookable),
    [staffList],
  );

  const visibleColumns = useMemo(() => {
    if (selectedMasterFilter === 'ALL') return bookableMasters;
    return bookableMasters.filter((m) => m.id === selectedMasterFilter);
  }, [bookableMasters, selectedMasterFilter]);

  const filteredAppointments = useMemo(
    () =>
      appointments.filter(
        (appointment) =>
          (selectedMasterFilter === 'ALL' || appointment.masterId === selectedMasterFilter) &&
          (selectedServiceFilter === 'ALL' ||
            (appointment.serviceIds ?? [appointment.serviceId]).includes(selectedServiceFilter)),
      ),
    [appointments, selectedMasterFilter, selectedServiceFilter],
  );

  function selectDate(date: string) {
    setIsLoading(true);
    setSelectedDate(date);
  }

  function selectView(next: CalendarView) {
    setIsLoading(true);
    setView(next);
    setReloadKey((key) => key + 1);
  }

  const isoWeekday = useMemo(
    () => getIsoWeekdayInTz(selectedDate, timezone),
    [selectedDate, timezone],
  );

  const dayRange = getLocalDayUtcRange(selectedDate, timezone);
  const dayStart = new Date(dayRange.fromUtc).getTime();
  const dayEnd = new Date(dayRange.toUtc).getTime();
  const starts = filteredAppointments.map((appointment) =>
    new Date(appointment.startAt).getTime() <= dayStart
      ? 0
      : getMinutesSinceMidnightInTz(appointment.startAt, timezone),
  );
  const ends = filteredAppointments.map((appointment) =>
    new Date(appointment.endAt).getTime() >= dayEnd
      ? 1440
      : getMinutesSinceMidnightInTz(appointment.endAt, timezone),
  );
  const hours = visibleColumns.flatMap((master) =>
    master.workingHours.filter((day) => day.dayOfWeek === isoWeekday),
  );
  const GRID_START_MIN =
    Math.floor(
      Math.min(480, ...starts, ...hours.map((day) => parseHhMmToMinutes(day.startTime))) / 60,
    ) * 60;
  const GRID_END_MIN =
    Math.ceil(
      Math.max(1320, ...ends, ...hours.map((day) => parseHhMmToMinutes(day.endTime))) / 60,
    ) * 60;
  const TIME_SLOTS = Array.from(
    { length: (GRID_END_MIN - GRID_START_MIN) / SLOT_STEP_MIN },
    (_, index) => {
      const minutes = GRID_START_MIN + index * SLOT_STEP_MIN;
      return {
        minutes,
        label: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      };
    },
  );

  const todayLocalDate = getTodayLocalDateInTz(timezone);
  const isToday = selectedDate === todayLocalDate;
  const showNowLine = isToday && currentMinutes >= GRID_START_MIN && currentMinutes <= GRID_END_MIN;
  const nowLineTopPx = (currentMinutes - GRID_START_MIN) * PX_PER_MINUTE;

  async function confirmMove() {
    if (!move || moving) return;
    setMoving(true);
    setMoveError(null);
    try {
      const updated = await updateAppointment(move.appointment.id, {
        masterId: move.master.id,
        startAt: localDateTimeToUtcIso(move.date, move.time, timezone),
      });
      handleAppointmentSaved(updated);
      setMoveNotice(
        updated.warnings?.length
          ? 'Запись перенесена. Проверьте график: новое время попадает вне смены, в перерыв или отсутствие.'
          : 'Запись перенесена',
      );
      setMove(null);
    } catch (error) {
      setMoveError(getApiErrorMessage(error));
    } finally {
      setMoving(false);
    }
  }

  function handleManualRefresh() {
    setIsRefreshing(true);
    setReloadKey((k) => k + 1);
  }

  function openNewAppointment(masterId?: string, timeLabel?: string) {
    setEditingAppointment(null);
    setPrefillMasterId(masterId);
    setPrefillTime(timeLabel ?? '10:00');
    setIsFormOpen(true);
  }

  function handleOpenEdit(appt: AppointmentDto) {
    setSelectedAppointment(null);
    setEditingAppointment(appt);
    setIsFormOpen(true);
  }

  function handleAppointmentSaved(saved: AppointmentDto) {
    setAppointments((prev) => {
      const exists = prev.some((a) => a.id === saved.id);
      if (exists) {
        return prev.map((a) => (a.id === saved.id ? saved : a));
      }
      return [...prev, saved];
    });
    setReloadKey((k) => k + 1);
  }

  function handleAppointmentUpdated(updated: AppointmentDto) {
    setSelectedAppointment(updated);
    setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  function handleAppointmentDeleted(deletedId: string) {
    setAppointments((prev) => prev.filter((a) => a.id !== deletedId));
  }

  if (!user) return null;

  return (
    <div className="space-y-5">
      <p role="status" className="text-sm text-primary">
        {moveNotice}
      </p>
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ru.schedulePage.title}</h1>
          <p className="mt-0.5 text-sm capitalize text-muted-foreground">
            {period.label} • {timezone}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Prev / Today / Next / Date input */}
          <div className="flex items-center rounded-lg border bg-card p-1 shadow-2xs">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => selectDate(shiftCalendarDate(selectedDate, view, -1, timezone))}
              aria-label={
                view === 'day'
                  ? ru.schedulePage.prevDayLabel
                  : view === 'week'
                    ? 'Предыдущая неделя'
                    : 'Предыдущий месяц'
              }
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={isToday ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                if (!isToday) selectDate(todayLocalDate);
              }}
              className="px-2.5 text-xs font-medium"
            >
              {ru.schedulePage.todayButton}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => selectDate(shiftCalendarDate(selectedDate, view, 1, timezone))}
              aria-label={
                view === 'day'
                  ? ru.schedulePage.nextDayLabel
                  : view === 'week'
                    ? 'Следующая неделя'
                    : 'Следующий месяц'
              }
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="relative">
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value && e.target.value !== selectedDate) selectDate(e.target.value);
              }}
              aria-label={ru.appointmentDialog.dateLabel}
              className="min-h-11 w-40 text-sm"
            />
          </div>

          <div
            role="group"
            aria-label="Вид календаря"
            className="flex rounded-lg border bg-card p-1"
          >
            {(
              [
                ['day', 'День'],
                ['week', 'Неделя'],
                ['month', 'Месяц'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={view === value ? 'secondary' : 'ghost'}
                aria-pressed={view === value}
                onClick={() => {
                  if (view !== value) selectView(value);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <select
            aria-label="Фильтр по услуге"
            value={selectedServiceFilter}
            onChange={(event) => setSelectedServiceFilter(event.target.value)}
            className="min-h-11 max-w-full rounded-md border bg-card px-3 text-sm"
          >
            <option value="ALL">Все услуги</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
          {user.role !== 'MASTER' && bookableMasters.length > 1 && (
            <select
              aria-label={ru.appointmentsPage.masterFilterLabel}
              value={selectedMasterFilter}
              onChange={(e) => setSelectedMasterFilter(e.target.value)}
              className="min-h-11 max-w-full rounded-md border border-input bg-card px-3 text-sm shadow-2xs"
            >
              <option value="ALL">{ru.schedulePage.allMastersFilter}</option>
              {bookableMasters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            aria-label={ru.schedulePage.refreshButton}
            title={ru.schedulePage.autoRefreshHint}
            className="gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">{ru.schedulePage.refreshButton}</span>
          </Button>

          <Button type="button" size="sm" onClick={() => openNewAppointment()} className="gap-1.5">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {ru.schedulePage.newAppointmentButton}
          </Button>
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && <Skeleton className="h-[640px] w-full rounded-xl" />}

      {/* Error state */}
      {!isLoading && loadError && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
              {ru.common.errorTitle}
            </CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={handleManualRefresh}>
              {ru.common.retry}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty bookable masters */}
      {!isLoading && !loadError && visibleColumns.length === 0 && (
        <Card className="border-dashed">
          <CardHeader className="items-center text-center">
            <CalendarIcon className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-base">{ru.schedulePage.emptyBookableMasters}</CardTitle>
          </CardHeader>
        </Card>
      )}

      {!isLoading && !loadError && (
        <div className={view === 'day' ? 'md:hidden' : ''}>
          <PeriodCalendar
            dates={period.dates}
            appointments={filteredAppointments}
            timezone={timezone}
            selectedDate={selectedDate}
            month={view === 'month'}
            onDay={(date) => {
              selectDate(date);
              selectView('day');
            }}
            onAppointment={setSelectedAppointment}
          />
        </div>
      )}

      {/* Day Schedule Grid */}
      {!isLoading && !loadError && visibleColumns.length > 0 && view === 'day' && (
        <Card className="hidden overflow-hidden shadow-xs md:block">
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Column Headers */}
              <div
                className="grid border-b bg-muted/40"
                style={{
                  gridTemplateColumns: `72px repeat(${visibleColumns.length}, minmax(210px, 1fr))`,
                }}
              >
                <div className="flex items-center justify-center border-r p-3 text-xs font-medium text-muted-foreground">
                  {timezone.split('/')[1] ?? timezone}
                </div>
                {visibleColumns.map((master) => {
                  const wh = master.workingHours.find((w) => w.dayOfWeek === isoWeekday);
                  return (
                    <div
                      key={master.id}
                      className="flex items-center justify-between gap-2 border-r px-3.5 py-2.5 last:border-r-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{master.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {wh
                            ? `${ru.schedulePage.workingHoursBadge}: ${wh.startTime}–${wh.endTime}`
                            : ru.schedulePage.dayOffBadge}
                        </p>
                      </div>
                      <Badge
                        variant={wh ? 'outline' : 'secondary'}
                        className="shrink-0 text-[11px]"
                      >
                        {wh ? `${wh.startTime}–${wh.endTime}` : ru.staffPage.dayOff}
                      </Badge>
                    </div>
                  );
                })}
              </div>

              {/* Grid Body */}
              <div
                className="relative grid"
                style={{
                  gridTemplateColumns: `72px repeat(${visibleColumns.length}, minmax(210px, 1fr))`,
                  height: `${TIME_SLOTS.length * ROW_HEIGHT_PX}px`,
                }}
              >
                {/* Left Time Axis */}
                <div className="border-r bg-muted/20">
                  {TIME_SLOTS.map((slot) => (
                    <div
                      key={slot.label}
                      className="flex items-start justify-end border-b pr-2 pt-1 text-[11px] font-medium text-muted-foreground"
                      style={{ height: `${ROW_HEIGHT_PX}px` }}
                    >
                      {slot.label}
                    </div>
                  ))}
                </div>

                {/* Master Columns */}
                {visibleColumns.map((master) => {
                  const wh = master.workingHours.find((w) => w.dayOfWeek === isoWeekday);
                  const workStartMin = wh ? parseHhMmToMinutes(wh.startTime) : -1;
                  const workEndMin = wh ? parseHhMmToMinutes(wh.endTime) : -1;

                  const masterAppts = filteredAppointments.filter((a) => a.masterId === master.id);
                  const masterTimeOffs = timeOffs.filter((t) => t.userId === master.id);
                  const { fromUtc, toUtc } = getLocalDayUtcRange(selectedDate, timezone);
                  const dayStartMs = new Date(fromUtc).getTime();
                  const dayEndMs = new Date(toUtc).getTime();

                  return (
                    <div
                      key={master.id}
                      className="relative border-r last:border-r-0"
                      onDragOver={(event) => {
                        if (dragId.current) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const appointment = appointments.find((item) => item.id === dragId.current);
                        dragId.current = null;
                        if (
                          !appointment ||
                          (appointment.status !== 'SCHEDULED' &&
                            appointment.status !== 'CONFIRMED') ||
                          moving
                        ) {
                          return;
                        }
                        if (
                          !(appointment.serviceIds ?? [appointment.serviceId]).every((id) =>
                            master.serviceIds.includes(id),
                          )
                        ) {
                          setMoveNotice('Выбранный мастер не выполняет все услуги записи');
                          return;
                        }
                        const index = Math.floor(
                          (event.clientY - event.currentTarget.getBoundingClientRect().top) /
                            ROW_HEIGHT_PX,
                        );
                        const slot = TIME_SLOTS[index];
                        if (!slot) return;
                        setMoveError(null);
                        setMove({ appointment, master, time: slot.label, date: selectedDate });
                      }}
                    >
                      {/* Background half-hour cells */}
                      {TIME_SLOTS.map((slot) => {
                        const isWorkingCell =
                          wh !== undefined &&
                          slot.minutes >= workStartMin &&
                          slot.minutes + SLOT_STEP_MIN <= workEndMin;

                        return (
                          <button
                            key={slot.label}
                            type="button"
                            onClick={() => openNewAppointment(master.id, slot.label)}
                            aria-label={`${master.name} • ${slot.label} — ${ru.schedulePage.clickCellHint}`}
                            title={`${master.name} • ${slot.label} — ${ru.schedulePage.clickCellHint}`}
                            className={`block w-full border-b text-left transition-colors ${
                              isWorkingCell
                                ? 'bg-background hover:bg-primary/5'
                                : 'bg-muted/45 hover:bg-muted/70'
                            }`}
                            style={{ height: `${ROW_HEIGHT_PX}px` }}
                          />
                        );
                      })}

                      {/* Recurring Break Hatched Block */}
                      {wh?.breakStart &&
                        wh?.breakEnd &&
                        (() => {
                          const bStart = Math.max(
                            GRID_START_MIN,
                            parseHhMmToMinutes(wh.breakStart),
                          );
                          const bEnd = Math.min(GRID_END_MIN, parseHhMmToMinutes(wh.breakEnd));
                          if (bEnd <= bStart) return null;
                          return (
                            <div
                              className="pointer-events-none absolute inset-x-1 z-[1] flex items-center justify-center rounded border border-dashed border-amber-500/50 bg-[repeating-linear-gradient(45deg,rgba(245,158,11,0.08),rgba(245,158,11,0.08)_6px,transparent_6px,transparent_12px)] text-[11px] font-medium text-amber-700 dark:text-amber-300"
                              style={{
                                top: `${(bStart - GRID_START_MIN) * PX_PER_MINUTE}px`,
                                height: `${(bEnd - bStart) * PX_PER_MINUTE}px`,
                              }}
                            >
                              Перерыв ({wh.breakStart}–{wh.breakEnd})
                            </div>
                          );
                        })()}

                      {/* TimeOff Hatched Blocks */}
                      {masterTimeOffs.map((to) => {
                        const sMs = new Date(to.startAt).getTime();
                        const eMs = new Date(to.endAt).getTime();
                        const startMin =
                          sMs <= dayStartMs
                            ? GRID_START_MIN
                            : Math.max(
                                GRID_START_MIN,
                                getMinutesSinceMidnightInTz(to.startAt, timezone),
                              );
                        const endMin =
                          eMs >= dayEndMs
                            ? GRID_END_MIN
                            : Math.min(
                                GRID_END_MIN,
                                getMinutesSinceMidnightInTz(to.endAt, timezone),
                              );
                        if (endMin <= startMin) return null;
                        const label =
                          to.kind === 'VACATION'
                            ? 'Отпуск'
                            : to.kind === 'SICK_LEAVE'
                              ? 'Больничный'
                              : 'Отсутствие';
                        return (
                          <div
                            key={to.id}
                            className="pointer-events-none absolute inset-x-1 z-[1] flex items-center justify-center rounded border border-dashed border-slate-500/50 bg-[repeating-linear-gradient(45deg,rgba(100,116,139,0.12),rgba(100,116,139,0.12)_6px,transparent_6px,transparent_12px)] text-[11px] font-medium text-slate-700 dark:text-slate-300"
                            style={{
                              top: `${(startMin - GRID_START_MIN) * PX_PER_MINUTE}px`,
                              height: `${(endMin - startMin) * PX_PER_MINUTE}px`,
                            }}
                          >
                            {label}
                          </div>
                        );
                      })}

                      {/* Positioned Appointment Blocks */}
                      {masterAppts.map((appt) => {
                        const startMin =
                          new Date(appt.startAt).getTime() <= dayStartMs
                            ? 0
                            : getMinutesSinceMidnightInTz(appt.startAt, timezone);
                        const endMin =
                          new Date(appt.endAt).getTime() >= dayEndMs
                            ? 1440
                            : getMinutesSinceMidnightInTz(appt.endAt, timezone);
                        const clampedStart = Math.max(GRID_START_MIN, startMin);
                        const clampedEnd = Math.min(
                          GRID_END_MIN,
                          Math.max(clampedStart + 15, endMin),
                        );

                        const topPx = (clampedStart - GRID_START_MIN) * PX_PER_MINUTE;
                        const heightPx = Math.max(
                          28,
                          (clampedEnd - clampedStart) * PX_PER_MINUTE - 2,
                        );

                        const startLabel = formatTimeInCompanyTz(appt.startAt, timezone);
                        const endLabel = formatTimeInCompanyTz(appt.endAt, timezone);

                        return (
                          <button
                            key={appt.id}
                            draggable={
                              (appt.status === 'SCHEDULED' || appt.status === 'CONFIRMED') &&
                              !moving
                            }
                            onDragStart={(event) => {
                              dragId.current = appt.id;
                              event.dataTransfer.effectAllowed = 'move';
                              event.dataTransfer.setData('text/plain', appt.id);
                            }}
                            onDragEnd={() => {
                              dragId.current = null;
                            }}
                            title="Откройте запись для редактирования или перетащите на новое время"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAppointment(appt);
                            }}
                            style={{
                              top: `${topPx}px`,
                              height: `${heightPx}px`,
                            }}
                            className={`absolute right-1.5 left-1.5 z-10 flex flex-col justify-between overflow-hidden rounded-lg border px-2.5 py-1 text-left shadow-2xs transition-all ${BLOCK_STYLES[appt.status]}`}
                          >
                            <div className="flex items-center justify-between gap-1 text-[11px] font-semibold leading-tight">
                              <span className="truncate">
                                {startLabel}–{endLabel} • {appt.clientName}
                              </span>
                              <span className="shrink-0">{formatPriceKgs(appt.price)}</span>
                            </div>
                            {heightPx >= 42 && (
                              <div className="truncate text-[11px] opacity-85">
                                {appt.service.name}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Current time indicator line */}
                {showNowLine && (
                  <div
                    className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
                    style={{ top: `${nowLineTopPx}px` }}
                  >
                    <span className="w-[72px] pr-1.5 text-right text-[10px] font-bold text-rose-600">
                      {ru.schedulePage.currentTimeLabel}
                    </span>
                    <div className="h-0.5 flex-1 bg-rose-500" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Dialog
        open={move !== null}
        onOpenChange={(open) => {
          if (!open && !moving) setMove(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Перенести запись?</DialogTitle>
          {move && (
            <div className="mt-4 space-y-3 text-sm">
              <p className="break-words font-medium">
                {move.appointment.clientName} · {move.appointment.service.name}
              </p>
              <p>
                Было: {formatTimeInCompanyTz(move.appointment.startAt, timezone)} ·{' '}
                {move.appointment.master.name}
              </p>
              <p>
                Новое время: {move.date} в {move.time} · {move.master.name}
              </p>
              <p className="text-muted-foreground">
                Длительность и стоимость сохранятся. Доступность проверим при подтверждении.
              </p>
              {moveError && (
                <p role="alert" className="text-destructive">
                  {moveError}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={moving} onClick={() => setMove(null)}>
                  Отмена
                </Button>
                <Button disabled={moving} onClick={() => void confirmMove()}>
                  {moving ? 'Переносим…' : 'Подтвердить перенос'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Appointment Details Drawer/Modal */}
      <AppointmentDetailsModal
        appointment={selectedAppointment}
        timezone={timezone}
        callerRole={user.role}
        onClose={() => setSelectedAppointment(null)}
        onUpdated={handleAppointmentUpdated}
        onDeleted={handleAppointmentDeleted}
        onEdit={handleOpenEdit}
      />

      {/* Create / Edit Appointment Dialog */}
      <AppointmentFormDialog
        open={isFormOpen}
        editingAppointment={editingAppointment}
        initialMasterId={prefillMasterId}
        initialDate={selectedDate}
        initialTime={prefillTime}
        services={services}
        staffList={staffList}
        timezone={timezone}
        callerRole={user.role}
        callerUserId={user.id}
        onClose={() => setIsFormOpen(false)}
        onSaved={handleAppointmentSaved}
      />
    </div>
  );
}
