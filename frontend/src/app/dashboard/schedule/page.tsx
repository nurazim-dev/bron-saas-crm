'use client';

import {
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  AppointmentDetailsModal,
  AppointmentFormDialog,
} from '@/components/appointments/appointment-dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { listAppointments } from '@/lib/api/appointments.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { listServices } from '@/lib/api/services.api';
import { listVisibleStaffForRole } from '@/lib/api/staff.api';
import { listTimeOff, type TimeOffDto } from '@/lib/api/time-off.api';
import {
  addDaysToLocalDateInTz,
  formatLocalDateRussian,
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

const GRID_START_HOUR = 8;
const GRID_END_HOUR = 22;
const GRID_START_MIN = GRID_START_HOUR * 60;
const GRID_END_MIN = GRID_END_HOUR * 60;
const SLOT_STEP_MIN = 30;
const ROW_HEIGHT_PX = 52;
const PX_PER_MINUTE = ROW_HEIGHT_PX / SLOT_STEP_MIN;

const TIME_SLOTS: { minutes: number; label: string }[] = (() => {
  const slots: { minutes: number; label: string }[] = [];
  for (let m = GRID_START_MIN; m < GRID_END_MIN; m += SLOT_STEP_MIN) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push({
      minutes: m,
      label: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    });
  }
  return slots;
})();

function parseHhMmToMinutes(hhMm: string): number {
  const [h, m] = hhMm.split(':');
  return Number(h) * 60 + Number(m);
}

const BLOCK_STYLES: Record<AppointmentStatus, string> = {
  SCHEDULED:
    'border-emerald-600/40 bg-emerald-500/15 text-emerald-950 hover:bg-emerald-500/25 dark:text-emerald-100',
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

  const [selectedDate, setSelectedDate] = useState(() => getTodayLocalDateInTz(timezone));
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

    async function loadData() {
      try {
        const { fromUtc, toUtc } = getLocalDayUtcRange(selectedDate, timezone);
        const [staffData, servicesData, apptsRes, timeOffData] = await Promise.all([
          listVisibleStaffForRole(userId, userRole),
          listServices(),
          listAppointments({
            from: fromUtc,
            to: toUtc,
            limit: 200,
          }),
          listTimeOff({ from: fromUtc, to: toUtc }),
        ]);

        if (!cancelled) {
          setStaffList(staffData);
          setServices(servicesData);
          setAppointments(apptsRes.data);
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
    };
  }, [reloadKey, selectedDate, timezone, user]);

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

  const isoWeekday = useMemo(
    () => getIsoWeekdayInTz(selectedDate, timezone),
    [selectedDate, timezone],
  );

  const todayLocalDate = getTodayLocalDateInTz(timezone);
  const isToday = selectedDate === todayLocalDate;
  const showNowLine = isToday && currentMinutes >= GRID_START_MIN && currentMinutes <= GRID_END_MIN;
  const nowLineTopPx = (currentMinutes - GRID_START_MIN) * PX_PER_MINUTE;

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
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ru.schedulePage.title}</h1>
          <p className="mt-0.5 text-sm capitalize text-muted-foreground">
            {formatLocalDateRussian(selectedDate, timezone)} • {timezone}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Prev / Today / Next / Date input */}
          <div className="flex items-center rounded-lg border bg-card p-1 shadow-2xs">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedDate((d) => addDaysToLocalDateInTz(d, -1, timezone))}
              aria-label={ru.schedulePage.prevDayLabel}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={isToday ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setSelectedDate(todayLocalDate)}
              className="px-2.5 text-xs font-medium"
            >
              {ru.schedulePage.todayButton}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedDate((d) => addDaysToLocalDateInTz(d, 1, timezone))}
              aria-label={ru.schedulePage.nextDayLabel}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="relative">
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              aria-label={ru.appointmentDialog.dateLabel}
              className="h-9 w-40 text-sm"
            />
          </div>

          {/* Master filter for OWNER */}
          {user.role === 'OWNER' && bookableMasters.length > 1 && (
            <select
              aria-label={ru.appointmentsPage.masterFilterLabel}
              value={selectedMasterFilter}
              onChange={(e) => setSelectedMasterFilter(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-2xs"
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

      {/* Day Schedule Grid */}
      {!isLoading && !loadError && visibleColumns.length > 0 && (
        <Card className="overflow-hidden shadow-xs">
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

                  const masterAppts = appointments.filter((a) => a.masterId === master.id);
                  const masterTimeOffs = timeOffs.filter((t) => t.userId === master.id);
                  const { fromUtc, toUtc } = getLocalDayUtcRange(selectedDate, timezone);
                  const dayStartMs = new Date(fromUtc).getTime();
                  const dayEndMs = new Date(toUtc).getTime();

                  return (
                    <div key={master.id} className="relative border-r last:border-r-0">
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
                        const startMin = getMinutesSinceMidnightInTz(appt.startAt, timezone);
                        const endMin = getMinutesSinceMidnightInTz(appt.endAt, timezone);
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
