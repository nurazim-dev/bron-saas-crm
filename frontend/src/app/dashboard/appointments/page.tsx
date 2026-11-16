'use client';

import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Plus,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AppointmentDetailsModal,
  AppointmentFormDialog,
  AppointmentStatusBadge,
} from '@/components/appointments/appointment-dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { listAppointments } from '@/lib/api/appointments.api';
import { getApiErrorMessage } from '@/lib/api/client';
import { getManualRemindersQueue, markManualReminderSent } from '@/lib/api/notifications.api';
import { listServices } from '@/lib/api/services.api';
import { listVisibleStaffForRole } from '@/lib/api/staff.api';
import {
  addDaysToLocalDateInTz,
  formatDateInCompanyTz,
  formatTimeInCompanyTz,
  getLocalDateRangeUtc,
  getTodayLocalDateInTz,
} from '@/lib/datetime';
import { formatDurationMin, formatPriceKgs, ru } from '@/lib/i18n/ru';
import { formatPhoneDisplay } from '@/lib/phone';
import { useAuthStore } from '@/stores/auth.store';
import type {
  AppointmentDto,
  AppointmentStatus,
  ManualReminderItemDto,
  ReminderMode,
  ServiceDto,
  StaffDto,
} from '@/types/api';

type PeriodTab = 'upcoming' | 'past' | 'custom' | 'reminders';
const PAGE_LIMIT = 20;

const ALL_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export default function AppointmentsPage() {
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const timezone = company?.timezone ?? 'Asia/Bishkek';

  const todayLocal = useMemo(() => getTodayLocalDateInTz(timezone), [timezone]);

  const [tab, setTab] = useState<PeriodTab>('upcoming');
  const [fromDate, setFromDate] = useState(() => todayLocal);
  const [toDate, setToDate] = useState(() => addDaysToLocalDateInTz(todayLocal, 30, timezone));
  const [masterFilter, setMasterFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const [appointments, setAppointments] = useState<AppointmentDto[]>([]);
  const [total, setTotal] = useState(0);
  const [reminderQueue, setReminderQueue] = useState<ManualReminderItemDto[]>([]);
  const [reminderModeState, setReminderModeState] = useState<ReminderMode>('MANUAL');
  const [markingSentId, setMarkingSentId] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<StaffDto[]>([]);
  const [services, setServices] = useState<ServiceDto[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Modals state
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentDto | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentDto | null>(null);

  // Load staff and services once
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const userRole = user.role;
    let cancelled = false;

    async function loadMeta() {
      try {
        const [staffData, servicesData] = await Promise.all([
          listVisibleStaffForRole(userId, userRole),
          listServices(),
        ]);
        if (!cancelled) {
          setStaffList(staffData);
          setServices(servicesData);
        }
      } catch {
        // Handled by main appointments load
      }
    }

    void loadMeta();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load paginated appointments whenever filters or page change
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadList() {
      try {
        if (tab === 'reminders') {
          const queueRes = await getManualRemindersQueue();
          if (!cancelled) {
            setReminderQueue(queueRes.items);
            setReminderModeState(queueRes.reminderMode);
            setLoadError(null);
          }
          return;
        }
        const effectiveTo = fromDate <= toDate ? toDate : fromDate;
        const { fromUtc, toUtc } = getLocalDateRangeUtc(fromDate, effectiveTo, timezone);

        const res = await listAppointments({
          from: fromUtc,
          to: toUtc,
          ...(masterFilter !== 'ALL' ? { masterId: masterFilter } : {}),
          ...(statusFilter !== 'ALL' ? { status: statusFilter as AppointmentStatus } : {}),
          page,
          limit: PAGE_LIMIT,
        });

        if (!cancelled) {
          const sorted =
            tab === 'past'
              ? [...res.data].sort((a, b) => b.startAt.localeCompare(a.startAt))
              : res.data;
          setAppointments(sorted);
          setTotal(res.meta.total);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(getApiErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadList();

    return () => {
      cancelled = true;
    };
  }, [fromDate, masterFilter, page, reloadKey, statusFilter, tab, timezone, toDate, user]);

  function handleSelectTab(nextTab: PeriodTab) {
    setTab(nextTab);
    setPage(1);
    setIsLoading(true);
    if (nextTab === 'upcoming') {
      setFromDate(todayLocal);
      setToDate(addDaysToLocalDateInTz(todayLocal, 30, timezone));
    } else if (nextTab === 'past') {
      setFromDate(addDaysToLocalDateInTz(todayLocal, -30, timezone));
      setToDate(addDaysToLocalDateInTz(todayLocal, -1, timezone));
    }
  }

  const filteredAppointments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return appointments;
    const digitsOnly = q.replace(/\D/g, '');
    return appointments.filter((appt) => {
      const matchesName = appt.clientName.toLowerCase().includes(q);
      const matchesPhone =
        appt.clientPhone.toLowerCase().includes(q) ||
        (digitsOnly.length > 0 && appt.clientPhone.replace(/\D/g, '').includes(digitsOnly));
      return matchesName || matchesPhone;
    });
  }, [appointments, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  function handleRetry() {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ru.appointmentsPage.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ru.appointmentsPage.subtitle}</p>
        </div>
        <Button
          onClick={() => {
            setEditingAppointment(null);
            setIsFormOpen(true);
          }}
          className="min-h-11 gap-2 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {ru.schedulePage.newAppointmentButton}
        </Button>
      </div>

      {/* Period Tabs & Filters Card */}
      <Card className="shadow-2xs">
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={tab === 'upcoming' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSelectTab('upcoming')}
              >
                {ru.appointmentsPage.tabUpcoming}
              </Button>
              <Button
                type="button"
                variant={tab === 'past' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSelectTab('past')}
              >
                {ru.appointmentsPage.tabPast}
              </Button>
              <Button
                type="button"
                variant={tab === 'custom' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSelectTab('custom')}
              >
                {ru.appointmentsPage.tabAll}
              </Button>
              <Button
                type="button"
                variant={tab === 'reminders' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSelectTab('reminders')}
              >
                Напоминания
              </Button>
            </div>

            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={ru.appointmentsPage.searchPlaceholder}
                className="h-9 pl-9 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="filter-from" className="text-xs">
                {ru.appointmentsPage.fromDateLabel}
              </Label>
              <Input
                id="filter-from"
                type="date"
                value={fromDate}
                onChange={(e) => {
                  if (e.target.value) {
                    setTab('custom');
                    setPage(1);
                    setIsLoading(true);
                    setFromDate(e.target.value);
                  }
                }}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="filter-to" className="text-xs">
                {ru.appointmentsPage.toDateLabel}
              </Label>
              <Input
                id="filter-to"
                type="date"
                value={toDate}
                onChange={(e) => {
                  if (e.target.value) {
                    setTab('custom');
                    setPage(1);
                    setIsLoading(true);
                    setToDate(e.target.value);
                  }
                }}
                className="h-9 text-sm"
              />
            </div>

            {user.role === 'OWNER' && (
              <div className="space-y-1">
                <Label htmlFor="filter-master" className="text-xs">
                  {ru.appointmentsPage.masterFilterLabel}
                </Label>
                <select
                  id="filter-master"
                  value={masterFilter}
                  onChange={(e) => {
                    setPage(1);
                    setIsLoading(true);
                    setMasterFilter(e.target.value);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ALL">{ru.appointmentsPage.allMasters}</option>
                  {staffList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="filter-status" className="text-xs">
                {ru.appointmentsPage.statusFilterLabel}
              </Label>
              <select
                id="filter-status"
                value={statusFilter}
                onChange={(e) => {
                  setPage(1);
                  setIsLoading(true);
                  setStatusFilter(e.target.value);
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="ALL">{ru.appointmentsPage.allStatuses}</option>
                {ALL_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {ru.appointmentStatuses[st]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

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
            <Button variant="outline" onClick={handleRetry}>
              {ru.common.retry}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Reminders queue tab */}
      {!isLoading && !loadError && tab === 'reminders' && (
        <Card className="shadow-2xs">
          <CardHeader>
            <CardTitle className="text-base">
              Очередь ручных напоминаний (ближайшие 48 часов)
            </CardTitle>
            <CardDescription>
              {reminderModeState === 'OFF'
                ? 'Напоминания сейчас выключены в настройках компании.'
                : reminderModeState === 'AUTO'
                  ? 'Включён автоматический режим. Здесь показаны записи, которым ещё не отправлено ручное напоминание.'
                  : 'Откройте чат WhatsApp с готовым текстом и отметьте напоминание как отправленное.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reminderQueue.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Все предстоящие записи на ближайшие 48 часов уже обработаны.
              </div>
            ) : (
              <div className="divide-y">
                {reminderQueue.map((item) => (
                  <div
                    key={item.id}
                    data-testid="manual-reminder-row"
                    className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.clientName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatPhoneDisplay(item.clientPhone)}
                        </span>
                        <Badge variant="outline">{item.clientLocale}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDateInCompanyTz(item.startAt, timezone)}{' '}
                        {formatTimeInCompanyTz(item.startAt, timezone)} • {item.serviceName} •{' '}
                        {item.masterName}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" variant="outline" className="gap-1.5">
                        <a href={item.whatsappUrl} target="_blank" rel="noreferrer">
                          Написать в WhatsApp
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={markingSentId === item.id}
                        onClick={async () => {
                          setMarkingSentId(item.id);
                          try {
                            await markManualReminderSent(item.id);
                            setReminderQueue((prev) => prev.filter((q) => q.id !== item.id));
                            toast.success('Напоминание отмечено как отправленное');
                          } catch (err) {
                            toast.error(getApiErrorMessage(err));
                          } finally {
                            setMarkingSentId(null);
                          }
                        }}
                        className="gap-1.5"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        Отправлено
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !loadError && tab !== 'reminders' && filteredAppointments.length === 0 && (
        <Card className="border-dashed">
          <CardHeader className="items-center text-center">
            <CalendarDays className="mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-base">{ru.appointmentsPage.emptyTitle}</CardTitle>
            <CardDescription className="max-w-md">
              {ru.appointmentsPage.emptyDescription}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Appointments Table / Cards */}
      {!isLoading && !loadError && tab !== 'reminders' && filteredAppointments.length > 0 && (
        <Card className="overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">{ru.appointmentsPage.colDateTime}</th>
                  <th className="px-4 py-3">{ru.appointmentsPage.colClient}</th>
                  <th className="px-4 py-3">{ru.appointmentsPage.colService}</th>
                  <th className="px-4 py-3">{ru.appointmentsPage.colMaster}</th>
                  <th className="px-4 py-3">{ru.appointmentsPage.colPrice}</th>
                  <th className="px-4 py-3">{ru.appointmentsPage.colStatus}</th>
                  <th className="px-4 py-3">{ru.appointmentsPage.colSource}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredAppointments.map((appt) => {
                  const dateStr = formatDateInCompanyTz(appt.startAt, timezone);
                  const startStr = formatTimeInCompanyTz(appt.startAt, timezone);
                  const endStr = formatTimeInCompanyTz(appt.endAt, timezone);

                  return (
                    <tr
                      key={appt.id}
                      onClick={() => setSelectedAppointment(appt)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-semibold text-foreground">
                          {startStr} – {endStr}
                        </div>
                        <div className="text-xs text-muted-foreground">{dateStr}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{appt.clientName}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatPhoneDisplay(appt.clientPhone)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{appt.service.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDurationMin(appt.service.durationMin)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{appt.master.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold">
                        {formatPriceKgs(appt.price)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <AppointmentStatusBadge status={appt.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant="outline" className="text-[11px]">
                          {ru.appointmentSources[appt.source]}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            <div>
              {ru.appointmentsPage.ofTotal}: <span className="font-semibold">{total}</span> •{' '}
              {ru.appointmentsPage.pageInfo} {page} / {totalPages}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={page <= 1}
                onClick={() => {
                  setIsLoading(true);
                  setPage((p) => Math.max(1, p - 1));
                }}
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {ru.appointmentsPage.prevPage}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={page >= totalPages}
                onClick={() => {
                  setIsLoading(true);
                  setPage((p) => p + 1);
                }}
              >
                {ru.appointmentsPage.nextPage}
                <ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Appointment Details Modal */}
      <AppointmentDetailsModal
        appointment={selectedAppointment}
        timezone={timezone}
        callerRole={user.role}
        onClose={() => setSelectedAppointment(null)}
        onUpdated={(updated) => {
          setSelectedAppointment(updated);
          setAppointments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        }}
        onDeleted={(deletedId) => {
          setAppointments((prev) => prev.filter((a) => a.id !== deletedId));
          setTotal((t) => Math.max(0, t - 1));
        }}
        onEdit={(appt) => {
          setSelectedAppointment(null);
          setEditingAppointment(appt);
          setIsFormOpen(true);
        }}
      />

      {/* Create / Edit Appointment Dialog */}
      <AppointmentFormDialog
        open={isFormOpen}
        editingAppointment={editingAppointment}
        services={services}
        staffList={staffList}
        timezone={timezone}
        callerRole={user.role}
        callerUserId={user.id}
        onClose={() => setIsFormOpen(false)}
        onSaved={() => {
          setIsLoading(true);
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}
