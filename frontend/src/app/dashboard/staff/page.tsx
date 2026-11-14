'use client';

import {
  AlertCircle,
  CalendarClock,
  CheckSquare,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { OwnerGuard } from '@/components/layout/auth-bootstrap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiErrorMessage } from '@/lib/api/client';
import { listServices } from '@/lib/api/services.api';
import {
  createStaff,
  deleteStaff,
  listStaff,
  replaceStaffServices,
  replaceStaffWorkingHours,
  updateStaff,
} from '@/lib/api/staff.api';
import { formatDurationMin, formatPriceKgs, ru } from '@/lib/i18n/ru';
import { formatPhoneDisplay, normalizePhoneE164OrNull } from '@/lib/phone';
import type { ServiceDto, StaffDto, WorkingHoursDto } from '@/types/api';

interface EditableDayRow {
  dayOfWeek: number;
  isWorking: boolean;
  startTime: string;
  endTime: string;
}

const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const TIME_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let h = 6; h <= 23; h++) {
    for (const m of [0, 15, 30, 45]) {
      opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  opts.push('23:59');
  return opts;
})();

function timeToMinutes(hhMm: string): number {
  const [h, m] = hhMm.split(':');
  return Number(h) * 60 + Number(m);
}

function buildEditableSchedule(workingHours: WorkingHoursDto[]): EditableDayRow[] {
  const byDay = new Map(workingHours.map((w) => [w.dayOfWeek, w]));
  return ISO_DAYS.map((dayOfWeek) => {
    const existing = byDay.get(dayOfWeek);
    if (existing) {
      return {
        dayOfWeek,
        isWorking: true,
        startTime: existing.startTime,
        endTime: existing.endTime,
      };
    }
    return {
      dayOfWeek,
      isWorking: false,
      startTime: '10:00',
      endTime: '20:00',
    };
  });
}

function StaffManagerContent() {
  const [staffList, setStaffList] = useState<StaffDto[]>([]);
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create / Edit staff profile modal state
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffDto | null>(null);
  const [staffName, setStaffName] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [enableLogin, setEnableLogin] = useState(false);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffIsBookable, setStaffIsBookable] = useState(true);
  const [staffIsActive, setStaffIsActive] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Services checklist modal state
  const [servicesStaff, setServicesStaff] = useState<StaffDto | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [isSavingServices, setIsSavingServices] = useState(false);

  // Working hours modal state
  const [hoursStaff, setHoursStaff] = useState<StaffDto | null>(null);
  const [dayRows, setDayRows] = useState<EditableDayRow[]>([]);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [isSavingHours, setIsSavingHours] = useState(false);

  // Delete confirmation modal state
  const [deletingStaff, setDeletingStaff] = useState<StaffDto | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [staffData, servicesData] = await Promise.all([listStaff(), listServices()]);
        if (!cancelled) {
          setStaffList(staffData);
          setServices(servicesData);
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

    void load();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function handleRetryLoad() {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }

  function openCreateStaffDialog() {
    setEditingStaff(null);
    setStaffName('');
    setStaffPhone('');
    setEnableLogin(false);
    setStaffEmail('');
    setStaffPassword('');
    setStaffIsBookable(true);
    setStaffIsActive(true);
    setProfileError(null);
    setIsProfileOpen(true);
  }

  function openEditStaffDialog(member: StaffDto) {
    setEditingStaff(member);
    setStaffName(member.name);
    setStaffPhone(member.phone ?? '');
    setEnableLogin(member.hasLogin || member.role === 'OWNER');
    setStaffEmail(member.email ?? '');
    setStaffPassword('');
    setStaffIsBookable(member.isBookable);
    setStaffIsActive(member.isActive);
    setProfileError(null);
    setIsProfileOpen(true);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);

    const trimmedName = staffName.trim();
    if (trimmedName.length < 2) {
      setProfileError(ru.validation.nameMin);
      return;
    }

    const trimmedPhone = staffPhone.trim();
    const normalizedPhone = trimmedPhone.length > 0 ? normalizePhoneE164OrNull(trimmedPhone) : null;
    if (trimmedPhone.length > 0 && !normalizedPhone) {
      setProfileError(ru.validation.phoneInvalid);
      return;
    }

    const trimmedEmail = staffEmail.trim().toLowerCase();
    const trimmedPassword = staffPassword;

    if (enableLogin) {
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setProfileError(ru.validation.emailInvalid);
        return;
      }
      const needsNewPassword = !editingStaff || !editingStaff.hasLogin;
      if (needsNewPassword && trimmedPassword.length < 8) {
        setProfileError(ru.validation.passwordMin);
        return;
      }
      if (trimmedPassword.length > 0 && trimmedPassword.length < 8) {
        setProfileError(ru.validation.passwordMin);
        return;
      }
    }

    setIsSavingProfile(true);
    try {
      if (!editingStaff) {
        const created = await createStaff({
          name: trimmedName,
          phone: normalizedPhone,
          ...(enableLogin
            ? {
                email: trimmedEmail,
                password: trimmedPassword,
              }
            : {}),
          isBookable: staffIsBookable,
          isActive: staffIsActive,
        });
        setStaffList((prev) => [...prev, created]);
        toast.success(ru.staffPage.createSuccess);
      } else {
        const updated = await updateStaff(editingStaff.id, {
          name: trimmedName,
          phone: normalizedPhone,
          ...(editingStaff.role === 'OWNER'
            ? {
                email: trimmedEmail,
                ...(trimmedPassword.length >= 8 ? { password: trimmedPassword } : {}),
              }
            : enableLogin
              ? {
                  email: trimmedEmail,
                  ...(trimmedPassword.length >= 8 ? { password: trimmedPassword } : {}),
                }
              : {
                  email: null,
                }),
          isBookable: staffIsBookable,
          ...(editingStaff.role === 'MASTER' ? { isActive: staffIsActive } : {}),
        });
        setStaffList((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        toast.success(ru.staffPage.updateSuccess);
      }
      setIsProfileOpen(false);
    } catch (err) {
      setProfileError(getApiErrorMessage(err));
    } finally {
      setIsSavingProfile(false);
    }
  }

  function openServicesDialog(member: StaffDto) {
    setServicesStaff(member);
    setSelectedServiceIds([...member.serviceIds]);
    setServicesError(null);
  }

  function toggleServiceId(id: string) {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  async function handleSaveServices() {
    if (!servicesStaff) return;
    setIsSavingServices(true);
    setServicesError(null);
    try {
      const updated = await replaceStaffServices(servicesStaff.id, selectedServiceIds);
      setStaffList((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      toast.success(ru.staffPage.servicesSaved);
      setServicesStaff(null);
    } catch (err) {
      setServicesError(getApiErrorMessage(err));
    } finally {
      setIsSavingServices(false);
    }
  }

  function openHoursDialog(member: StaffDto) {
    setHoursStaff(member);
    setDayRows(buildEditableSchedule(member.workingHours));
    setHoursError(null);
  }

  function updateDayRow(dayOfWeek: number, patch: Partial<EditableDayRow>) {
    setDayRows((prev) =>
      prev.map((row) => (row.dayOfWeek === dayOfWeek ? { ...row, ...patch } : row)),
    );
  }

  function copyMondayToDays(maxDay: number) {
    setDayRows((prev) => {
      const monday = prev.find((r) => r.dayOfWeek === 1);
      if (!monday) return prev;
      return prev.map((row) =>
        row.dayOfWeek >= 2 && row.dayOfWeek <= maxDay
          ? {
              ...row,
              isWorking: true,
              startTime: monday.startTime,
              endTime: monday.endTime,
            }
          : row,
      );
    });
  }

  async function handleSaveHours() {
    if (!hoursStaff) return;
    setHoursError(null);

    const activeDays = dayRows.filter((r) => r.isWorking);
    for (const day of activeDays) {
      if (timeToMinutes(day.startTime) >= timeToMinutes(day.endTime)) {
        const dayName = ru.staffPage.weekdays[day.dayOfWeek] ?? '';
        setHoursError(`${dayName}: ${ru.validation.timeRangeInvalid}`);
        return;
      }
    }

    setIsSavingHours(true);
    try {
      const updated = await replaceStaffWorkingHours(
        hoursStaff.id,
        activeDays.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          startTime: d.startTime,
          endTime: d.endTime,
        })),
      );
      setStaffList((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      toast.success(ru.staffPage.hoursSaved);
      setHoursStaff(null);
    } catch (err) {
      setHoursError(getApiErrorMessage(err));
    } finally {
      setIsSavingHours(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingStaff) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteStaff(deletingStaff.id);
      setStaffList((prev) => prev.filter((m) => m.id !== deletingStaff.id));
      toast.success(ru.staffPage.deleteSuccess);
      setDeletingStaff(null);
    } catch (err) {
      setDeleteError(getApiErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{ru.staffPage.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{ru.staffPage.subtitle}</p>
        </div>
        <Button onClick={openCreateStaffDialog} className="min-h-11 gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {ru.staffPage.addMaster}
        </Button>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
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
            <Button variant="outline" onClick={handleRetryLoad}>
              {ru.common.retry}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Staff cards */}
      {!isLoading && !loadError && (
        <div className="grid gap-4 lg:grid-cols-2">
          {staffList.map((member) => {
            const assignedNames = member.serviceIds
              .map((sid) => serviceById.get(sid)?.name)
              .filter((n): n is string => Boolean(n));

            return (
              <Card key={member.id} className="flex flex-col justify-between shadow-2xs">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                        {member.name}
                      </CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {member.email && <span>{member.email}</span>}
                        {member.phone && <span>{formatPhoneDisplay(member.phone)}</span>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={member.role === 'OWNER' ? 'default' : 'secondary'}>
                        {ru.roles[member.role]}
                      </Badge>
                      <Badge variant="outline">
                        {member.hasLogin ? ru.staffPage.badgeHasLogin : ru.staffPage.badgeNoLogin}
                      </Badge>
                      <Badge variant={member.isBookable ? 'default' : 'secondary'}>
                        {member.isBookable
                          ? ru.staffPage.badgeBookable
                          : ru.staffPage.badgeNotBookable}
                      </Badge>
                      {!member.isActive && (
                        <Badge variant="destructive">{ru.staffPage.badgeInactive}</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Assigned services & working days summary */}
                  <div className="grid gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {ru.staffPage.servicesCountLabel}: {member.serviceIds.length}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-foreground">
                        {assignedNames.length > 0 ? assignedNames.join(', ') : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {ru.staffPage.workingDaysCountLabel}: {member.workingHours.length}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {ISO_DAYS.map((day) => {
                          const wh = member.workingHours.find((w) => w.dayOfWeek === day);
                          return (
                            <span
                              key={day}
                              title={wh ? `${wh.startTime}–${wh.endTime}` : ru.staffPage.dayOff}
                              className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                wh ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {ru.staffPage.weekdaysShort[day]}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openServicesDialog(member)}
                      >
                        <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        {ru.staffPage.configureServices} ({member.serviceIds.length})
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openHoursDialog(member)}
                      >
                        <CalendarClock
                          className="mr-1.5 h-3.5 w-3.5 text-primary"
                          aria-hidden="true"
                        />
                        {ru.staffPage.configureHours}
                      </Button>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditStaffDialog(member)}
                        aria-label={`${ru.common.edit}: ${member.name}`}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        {ru.common.edit}
                      </Button>
                      {member.role === 'MASTER' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setDeletingStaff(member);
                            setDeleteError(null);
                          }}
                          aria-label={`${ru.common.delete}: ${member.name}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Staff Profile Modal */}
      {isProfileOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-profile-dialog-title"
        >
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <CardTitle id="staff-profile-dialog-title" className="text-lg">
                {editingStaff ? ru.staffPage.editDialogTitle : ru.staffPage.createDialogTitle}
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsProfileOpen(false)}
                aria-label={ru.common.close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="pt-5">
              <form onSubmit={handleSaveProfile} noValidate className="space-y-4">
                {profileError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{profileError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="staff-name">{ru.staffPage.nameLabel}</Label>
                  <Input
                    id="staff-name"
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    placeholder={ru.staffPage.namePlaceholder}
                    className="min-h-11"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="staff-phone">{ru.staffPage.phoneLabel}</Label>
                  <Input
                    id="staff-phone"
                    type="tel"
                    value={staffPhone}
                    onChange={(e) => setStaffPhone(e.target.value)}
                    placeholder={ru.staffPage.phonePlaceholder}
                    className="min-h-11"
                  />
                </div>

                {/* Bookable & Active switches */}
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={staffIsBookable}
                      onChange={(e) => setStaffIsBookable(e.target.checked)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    <UserCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span>{ru.staffPage.isBookableLabel}</span>
                  </label>

                  {(!editingStaff || editingStaff.role === 'MASTER') && (
                    <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={staffIsActive}
                        onChange={(e) => setStaffIsActive(e.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <span>{ru.staffPage.isActiveLabel}</span>
                    </label>
                  )}
                </div>

                {/* Login credentials section */}
                <div className="space-y-3 rounded-lg border p-3.5">
                  {(!editingStaff || editingStaff.role === 'MASTER') && (
                    <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={enableLogin}
                        onChange={(e) => setEnableLogin(e.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
                      <span>{ru.staffPage.enableLoginLabel}</span>
                    </label>
                  )}

                  {enableLogin && (
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1.5">
                        <Label htmlFor="staff-email">{ru.staffPage.emailLabel}</Label>
                        <Input
                          id="staff-email"
                          type="email"
                          value={staffEmail}
                          onChange={(e) => setStaffEmail(e.target.value)}
                          placeholder={ru.staffPage.emailPlaceholder}
                          className="min-h-11"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="staff-password">
                          {editingStaff?.hasLogin
                            ? ru.staffPage.newPasswordLabel
                            : ru.staffPage.passwordLabel}
                        </Label>
                        <Input
                          id="staff-password"
                          type="password"
                          value={staffPassword}
                          onChange={(e) => setStaffPassword(e.target.value)}
                          placeholder={ru.staffPage.passwordPlaceholder}
                          className="min-h-11"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsProfileOpen(false)}
                    disabled={isSavingProfile}
                  >
                    {ru.common.cancel}
                  </Button>
                  <Button type="submit" disabled={isSavingProfile} className="min-h-10">
                    {isSavingProfile ? ru.common.saving : ru.common.save}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Services Assignment Checklist Modal */}
      {servicesStaff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-services-dialog-title"
        >
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <div>
                <CardTitle id="staff-services-dialog-title" className="text-lg">
                  {ru.staffPage.servicesModalTitle}: {servicesStaff.name}
                </CardTitle>
                <CardDescription>{ru.staffPage.servicesModalSubtitle}</CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setServicesStaff(null)}
                aria-label={ru.common.close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {servicesError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{servicesError}</span>
                </div>
              )}

              {services.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {ru.staffPage.noServicesInCompany}
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      {ru.staffPage.servicesCountLabel}: {selectedServiceIds.length} /{' '}
                      {services.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setSelectedServiceIds(services.map((s) => s.id))}
                      >
                        <CheckSquare className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                        {ru.staffPage.selectAllServices}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setSelectedServiceIds([])}
                      >
                        {ru.staffPage.clearAllServices}
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {services.map((service) => {
                      const checked = selectedServiceIds.includes(service.id);
                      return (
                        <label
                          key={service.id}
                          className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
                            checked ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleServiceId(service.id)}
                              className="h-4 w-4 rounded border-input accent-primary"
                            />
                            <div>
                              <p className="text-sm font-medium">{service.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatDurationMin(service.durationMin)} •{' '}
                                {formatPriceKgs(service.price)}
                              </p>
                            </div>
                          </div>
                          {!service.isActive && (
                            <Badge variant="secondary">{ru.servicesPage.statusInactive}</Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setServicesStaff(null)}
                  disabled={isSavingServices}
                >
                  {ru.common.cancel}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSaveServices()}
                  disabled={isSavingServices}
                  className="min-h-10"
                >
                  {isSavingServices ? ru.common.saving : ru.common.save}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Weekly Working Hours Editor Modal */}
      {hoursStaff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-hours-dialog-title"
        >
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
              <div>
                <CardTitle id="staff-hours-dialog-title" className="text-lg">
                  {ru.staffPage.hoursModalTitle}: {hoursStaff.name}
                </CardTitle>
                <CardDescription>{ru.staffPage.hoursModalSubtitle}</CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setHoursStaff(null)}
                aria-label={ru.common.close}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {hoursError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{hoursError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => copyMondayToDays(5)}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {ru.staffPage.copyToWeekdays}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => copyMondayToDays(7)}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {ru.staffPage.copyToAllDays}
                </Button>
              </div>

              <div className="space-y-2">
                {dayRows.map((row) => (
                  <div
                    key={row.dayOfWeek}
                    className={`flex flex-col justify-between gap-3 rounded-lg border p-3 sm:flex-row sm:items-center ${
                      row.isWorking ? 'bg-card' : 'bg-muted/30 opacity-80'
                    }`}
                  >
                    <label className="flex min-w-44 cursor-pointer items-center gap-2.5 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={row.isWorking}
                        onChange={(e) =>
                          updateDayRow(row.dayOfWeek, { isWorking: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <span>{ru.staffPage.weekdays[row.dayOfWeek]}</span>
                    </label>

                    {row.isWorking ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {ru.staffPage.startTimeLabel}
                        </span>
                        <select
                          aria-label={`${ru.staffPage.weekdays[row.dayOfWeek]} ${ru.staffPage.startTimeLabel}`}
                          value={row.startTime}
                          onChange={(e) =>
                            updateDayRow(row.dayOfWeek, { startTime: e.target.value })
                          }
                          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <span className="text-xs text-muted-foreground">
                          {ru.staffPage.endTimeLabel}
                        </span>
                        <select
                          aria-label={`${ru.staffPage.weekdays[row.dayOfWeek]} ${ru.staffPage.endTimeLabel}`}
                          value={row.endTime}
                          onChange={(e) => updateDayRow(row.dayOfWeek, { endTime: e.target.value })}
                          className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
                        >
                          {TIME_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        {ru.staffPage.dayOff}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setHoursStaff(null)}
                  disabled={isSavingHours}
                >
                  {ru.common.cancel}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSaveHours()}
                  disabled={isSavingHours}
                  className="min-h-10"
                >
                  {isSavingHours ? ru.common.saving : ru.common.save}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Staff Confirmation Modal */}
      {deletingStaff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-staff-title"
        >
          <Card className="w-full max-w-md shadow-lg">
            <CardHeader>
              <CardTitle id="delete-staff-title" className="text-lg">
                {ru.staffPage.deleteConfirmTitle}
              </CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">«{deletingStaff.name}»</span> —{' '}
                {ru.staffPage.deleteConfirmText}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {deleteError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeletingStaff(null)}
                  disabled={isDeleting}
                >
                  {ru.common.cancel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleConfirmDelete()}
                  disabled={isDeleting}
                >
                  {isDeleting ? ru.common.deleting : ru.common.delete}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function StaffPage() {
  return (
    <OwnerGuard>
      <StaffManagerContent />
    </OwnerGuard>
  );
}
