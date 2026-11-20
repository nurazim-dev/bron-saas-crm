'use client';

import {
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Plus,
  Settings,
  Sparkles,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
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
import { Skeleton } from '@/components/ui/skeleton';
import { listAppointments } from '@/lib/api/appointments.api';
import {
  dismissOnboarding,
  getOnboardingState,
  type OnboardingStateDto,
} from '@/lib/api/onboarding.api';
import { listServices } from '@/lib/api/services.api';
import { listVisibleStaffForRole } from '@/lib/api/staff.api';
import {
  addDaysToLocalDateInTz,
  formatDateInCompanyTz,
  formatTimeInCompanyTz,
  getLocalDateRangeUtc,
  getLocalDayUtcRange,
  getTodayLocalDateInTz,
} from '@/lib/datetime';
import { formatDurationMin, formatPriceKgs, ru } from '@/lib/i18n/ru';
import { formatPhoneDisplay } from '@/lib/phone';
import { useAuthStore } from '@/stores/auth.store';
import type { AppointmentDto, ServiceDto, StaffDto } from '@/types/api';

export default function DashboardOverviewPage() {
  const user = useAuthStore((s) => s.user);
  const company = useAuthStore((s) => s.company);
  const timezone = company?.timezone ?? 'Asia/Bishkek';

  const [todayAppointments, setTodayAppointments] = useState<AppointmentDto[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<AppointmentDto[]>([]);
  const [pendingPrepaymentCount, setPendingPrepaymentCount] = useState(0);
  const [onboardingState, setOnboardingState] = useState<OnboardingStateDto | null>(null);
  const [staffList, setStaffList] = useState<StaffDto[]>([]);
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentDto | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<AppointmentDto | null>(null);

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const userRole = user.role;
    let cancelled = false;

    async function loadOverview() {
      try {
        const todayLocal = getTodayLocalDateInTz(timezone);
        const todayRange = getLocalDayUtcRange(todayLocal, timezone);
        const next30Range = getLocalDateRangeUtc(
          todayLocal,
          addDaysToLocalDateInTz(todayLocal, 30, timezone),
          timezone,
        );

        const [todayRes, upcomingRes, pendingPrepRes, onbState, staffData, servicesData] =
          await Promise.all([
            listAppointments({
              from: todayRange.fromUtc,
              to: todayRange.toUtc,
              limit: 200,
            }),
            listAppointments({
              from: new Date().toISOString(),
              to: next30Range.toUtc,
              limit: 20,
            }),
            listAppointments({
              from: new Date().toISOString(),
              to: next30Range.toUtc,
              prepaymentStatus: 'PENDING',
              limit: 1,
            }),
            userRole === 'OWNER' ? getOnboardingState().catch(() => null) : Promise.resolve(null),
            listVisibleStaffForRole(userId, userRole),
            listServices(),
          ]);

        if (!cancelled) {
          setTodayAppointments(todayRes.data);
          setUpcomingAppointments(
            upcomingRes.data
              .filter((a) => ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status))
              .slice(0, 5),
          );
          setPendingPrepaymentCount(pendingPrepRes.meta.total);
          setOnboardingState(onbState);
          setStaffList(staffData);
          setServices(servicesData);
        }
      } catch {
        // Keep clean fallback
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [reloadKey, timezone, user]);

  const todayStats = useMemo(() => {
    let scheduled = 0;
    let completed = 0;
    let cancelledOrNoShow = 0;
    let revenue = 0;

    for (const appt of todayAppointments) {
      if (
        appt.status === 'SCHEDULED' ||
        appt.status === 'CONFIRMED' ||
        appt.status === 'IN_PROGRESS'
      ) {
        scheduled++;
        revenue += Number(appt.price) || 0;
      } else if (appt.status === 'COMPLETED') {
        completed++;
        revenue += Number(appt.price) || 0;
      } else {
        cancelledOrNoShow++;
      }
    }

    return { scheduled, completed, cancelledOrNoShow, revenue };
  }, [todayAppointments]);

  if (!user || !company) {
    return null;
  }

  const isOwner = user.role === 'OWNER';
  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/b/${company.slug}`
      : `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/b/${company.slug}`;

  async function handleCopyPublicLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(ru.dashboard.linkCopied);
    } catch {
      toast.info(publicUrl);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {ru.dashboard.welcomeTitle}, {user.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner ? ru.dashboard.welcomeSubtitleOwner : ru.dashboard.welcomeSubtitleMaster}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingAppointment(null);
            setIsFormOpen(true);
          }}
          className="min-h-11 gap-2 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {ru.overviewPage.createNewAppointment}
        </Button>
      </div>

      {/* Today's Stats KPI Cards */}
      {!isLoading && isOwner && onboardingState?.showChecklist && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
            <div>
              <CardTitle className="text-base">
                Запуск онлайн-записи ({onboardingState.completedCount} из{' '}
                {onboardingState.totalSteps})
              </CardTitle>
              <CardDescription>
                Завершите настройку, чтобы клиенты могли записываться к вам онлайн.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  const updated = await dismissOnboarding();
                  setOnboardingState(updated);
                } catch {
                  // Ignore
                }
              }}
            >
              Скрыть
            </Button>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-3 text-xs">
              <span>{onboardingState.steps.profileComplete ? '✓' : '○'} Контакты</span>
              <span>{onboardingState.steps.hasServices ? '✓' : '○'} Услуги</span>
              <span>{onboardingState.steps.hasBookableMaster ? '✓' : '○'} Мастер и график</span>
              <span>{onboardingState.steps.linkShared ? '✓' : '○'} Ссылка</span>
            </div>
            <Button asChild size="sm">
              <Link href="/dashboard/onboarding">Продолжить настройку</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {!isLoading && pendingPrepaymentCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <div>
            <span className="font-semibold">Ожидают предоплату: {pendingPrepaymentCount}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              Подтвердите получение оплаты до истечения срока удержания слота.
            </span>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/appointments">Открыть записи</Link>
          </Button>
        </div>
      )}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">
                {ru.overviewPage.scheduledToday}
              </CardDescription>
              <Clock className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{todayStats.scheduled}</p>
            </CardContent>
          </Card>

          <Card className="shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">
                {ru.overviewPage.completedToday}
              </CardDescription>
              <CheckCircle2 className="h-4 w-4 text-sky-600" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{todayStats.completed}</p>
            </CardContent>
          </Card>

          <Card className="shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">
                {ru.overviewPage.cancelledOrNoShowToday}
              </CardDescription>
              <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{todayStats.cancelledOrNoShow}</p>
            </CardContent>
          </Card>

          <Card className="shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">
                {ru.overviewPage.expectedRevenueToday}
              </CardDescription>
              <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatPriceKgs(todayStats.revenue)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Next 5 Upcoming Appointments */}
      <Card className="shadow-2xs">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">{ru.overviewPage.upcomingSectionTitle}</CardTitle>
            <CardDescription>{ru.overviewPage.upcomingSectionSubtitle}</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/appointments">{ru.overviewPage.viewAllAppointments}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2.5">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : upcomingAppointments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {ru.overviewPage.noUpcomingAppointments}
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {upcomingAppointments.map((appt) => {
                const dateStr = formatDateInCompanyTz(appt.startAt, timezone);
                const startStr = formatTimeInCompanyTz(appt.startAt, timezone);
                const endStr = formatTimeInCompanyTz(appt.endAt, timezone);

                return (
                  <button
                    key={appt.id}
                    type="button"
                    onClick={() => setSelectedAppointment(appt)}
                    className="flex w-full flex-col justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {dateStr}, {startStr}–{endStr} • {appt.clientName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {appt.service.name} ({formatDurationMin(appt.service.durationMin)}) •{' '}
                        {appt.master.name} • {formatPhoneDisplay(appt.clientPhone)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold">{formatPriceKgs(appt.price)}</span>
                      <AppointmentStatusBadge status={appt.status} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Public Booking Link Card */}
      <Card className="border-primary/25 bg-primary/5 shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-semibold">
              {ru.dashboard.publicLinkLabel}
            </CardTitle>
            <Badge variant={company.publicBookingEnabled ? 'default' : 'secondary'}>
              {company.publicBookingEnabled
                ? ru.dashboard.bookingEnabled
                : ru.dashboard.bookingDisabled}
            </Badge>
          </div>
          <CardDescription className="font-mono text-xs sm:text-sm">
            /b/{company.slug}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={() => void handleCopyPublicLink()}>
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            {ru.dashboard.copyLink}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/b/${company.slug}`} target="_blank">
              <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
              {ru.dashboard.openPublicPage}
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-base font-semibold">{ru.dashboard.quickActionsTitle}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/dashboard/schedule" className="group block">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Calendar className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base">{ru.nav.schedule}</CardTitle>
                  <CardDescription className="text-xs">{ru.dashboard.goToSchedule}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/dashboard/appointments" className="group block">
            <Card className="h-full transition-colors group-hover:border-primary/50">
              <CardHeader className="flex flex-row items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardList className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <CardTitle className="text-base">{ru.nav.appointments}</CardTitle>
                  <CardDescription className="text-xs">
                    {ru.dashboard.goToAppointments}
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>

          {isOwner && (
            <>
              <Link href="/dashboard/services" className="group block">
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardHeader className="flex flex-row items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Sparkles className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{ru.nav.services}</CardTitle>
                      <CardDescription className="text-xs">
                        {ru.dashboard.goToServices}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </Link>

              <Link href="/dashboard/staff" className="group block">
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardHeader className="flex flex-row items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Users className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{ru.nav.staff}</CardTitle>
                      <CardDescription className="text-xs">
                        {ru.dashboard.goToStaff}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </Link>

              <Link href="/dashboard/settings" className="group block">
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardHeader className="flex flex-row items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Settings className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{ru.nav.settings}</CardTitle>
                      <CardDescription className="text-xs">
                        {ru.dashboard.goToSettings}
                      </CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Appointment Details Modal */}
      <AppointmentDetailsModal
        appointment={selectedAppointment}
        timezone={timezone}
        callerRole={user.role}
        onClose={() => setSelectedAppointment(null)}
        onUpdated={(updated) => {
          setSelectedAppointment(updated);
          setReloadKey((k) => k + 1);
        }}
        onDeleted={() => {
          setReloadKey((k) => k + 1);
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
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}
