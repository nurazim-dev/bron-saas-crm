'use client';

import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  MessageCircle,
  Package,
  Pencil,
  Phone,
  Play,
  RotateCcw,
  Trash2,
  User,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  applyPrepaymentAction,
  changeAppointmentStatus,
  createAppointment,
  deleteAppointment,
  getStaffAvailability,
  updateAppointment,
} from '@/lib/api/appointments.api';
import { type ClientListItemDto, listClients } from '@/lib/api/clients.api';
import { listServicePackages } from '@/lib/api/services.api';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api/client';
import {
  extractLocalDateAndTime,
  formatDateInCompanyTz,
  formatTimeInCompanyTz,
  getTodayLocalDateInTz,
  localDateTimeToUtcIso,
} from '@/lib/datetime';
import { formatDurationMin, formatPriceKgs, ru } from '@/lib/i18n/ru';
import { formatPhoneDisplay, getWhatsAppUrl, normalizePhoneE164OrNull } from '@/lib/phone';
import type {
  AppointmentDto,
  AppointmentStatus,
  AvailableSlotDto,
  PrepaymentStatus,
  Role,
  ServiceDto,
  ServicePackageDto,
  StaffDto,
} from '@/types/api';

export function PrepaymentStatusBadge({ status }: { status?: PrepaymentStatus }) {
  if (!status || status === 'NOT_REQUIRED') return null;
  const styles: Record<Exclude<PrepaymentStatus, 'NOT_REQUIRED'>, string> = {
    PENDING: 'border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300',
    RECEIVED: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    REFUNDED: 'border-slate-400/30 bg-slate-500/10 text-muted-foreground',
  };
  const labels: Record<Exclude<PrepaymentStatus, 'NOT_REQUIRED'>, string> = {
    PENDING: 'Ожидает предоплату',
    RECEIVED: 'Предоплата получена',
    REFUNDED: 'Предоплата возвращена',
  };
  return (
    <Badge variant="outline" className={styles[status]}>
      {labels[status]}
    </Badge>
  );
}

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const styles: Record<AppointmentStatus, string> = {
    SCHEDULED: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
    CONFIRMED: 'border-indigo-500/30 bg-indigo-500/15 text-indigo-800 dark:text-indigo-300',
    IN_PROGRESS: 'border-violet-500/30 bg-violet-500/15 text-violet-800 dark:text-violet-300',
    COMPLETED: 'border-sky-500/30 bg-sky-500/15 text-sky-800 dark:text-sky-300',
    CANCELLED: 'border-neutral-400/30 bg-neutral-500/10 text-muted-foreground line-through',
    NO_SHOW: 'border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-300',
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {ru.appointmentStatuses[status]}
    </span>
  );
}

interface AppointmentDetailsDrawerProps {
  appointment: AppointmentDto | null;
  timezone: string;
  callerRole: Role;
  onClose: () => void;
  onUpdated: (updated: AppointmentDto) => void;
  onDeleted: (deletedId: string) => void;
  onEdit: (appointment: AppointmentDto) => void;
}

export function AppointmentDetailsModal(props: AppointmentDetailsDrawerProps) {
  if (!props.appointment) return null;
  return (
    <AppointmentDetailsModalInner
      key={props.appointment.id}
      {...props}
      appointment={props.appointment}
    />
  );
}

function AppointmentDetailsModalInner({
  appointment,
  timezone,
  callerRole,
  onClose,
  onUpdated,
  onDeleted,
  onEdit,
}: Omit<AppointmentDetailsDrawerProps, 'appointment'> & { appointment: AppointmentDto }) {
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const whatsappUrl = getWhatsAppUrl(appointment.clientPhone);
  const startLabel = formatTimeInCompanyTz(appointment.startAt, timezone);
  const endLabel = formatTimeInCompanyTz(appointment.endAt, timezone);
  const dateLabel = formatDateInCompanyTz(appointment.startAt, timezone);

  async function handleStatusChange(nextStatus: AppointmentStatus) {
    setIsChangingStatus(true);
    setActionError(null);
    try {
      const updated = await changeAppointmentStatus(appointment.id, nextStatus);
      onUpdated(updated);
      toast.success(ru.appointmentDialog.statusChangedSuccess);
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handlePrepaymentAction(action: 'RECEIVED' | 'WAIVE' | 'REFUND') {
    setIsChangingStatus(true);
    setActionError(null);
    try {
      const updated = await applyPrepaymentAction(appointment.id, action);
      onUpdated(updated);
      toast.success(
        action === 'RECEIVED'
          ? 'Предоплата подтверждена'
          : action === 'WAIVE'
            ? 'Требование предоплаты снято'
            : 'Предоплата отмечена как возвращённая',
      );
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteAppointment(appointment.id);
      onDeleted(appointment.id);
      toast.success(ru.appointmentDialog.deleteSuccess);
      onClose();
    } catch (err) {
      setActionError(getApiErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="flex w-full flex-col justify-between bg-background p-6 shadow-xl">
        <div className="space-y-5">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <DialogTitle id="appointment-details-title" className="text-lg font-bold">
                {ru.appointmentDialog.detailsTitle}
              </DialogTitle>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <AppointmentStatusBadge status={appointment.status} />
                <Badge variant="outline">{ru.appointmentSources[appointment.source]}</Badge>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label={ru.common.close}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {actionError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Client Card */}
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                <User className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{appointment.clientName}</p>
                <p className="text-sm text-muted-foreground">
                  {formatPhoneDisplay(appointment.clientPhone)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={`tel:${appointment.clientPhone}`}>
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {ru.appointmentDialog.callClient}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/clients/${appointment.clientId}`}>Карточка клиента</Link>
              </Button>
              {whatsappUrl && (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    {ru.appointmentDialog.openWhatsApp}
                  </a>
                </Button>
              )}
            </div>
          </div>

          {/* Time, Service, Master, Price */}
          <div className="space-y-3 rounded-xl border p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                {ru.appointmentDialog.dateLabel}
              </span>
              <span className="font-medium">{dateLabel}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {ru.appointmentDialog.timeLabel}
              </span>
              <span className="font-semibold">
                {startLabel} – {endLabel} ({formatDurationMin(appointment.service.durationMin)})
              </span>
            </div>

            <div className="flex items-center justify-between border-t pt-2.5">
              <span className="text-muted-foreground">{ru.appointmentDialog.serviceLabel}</span>
              <span className="text-right font-medium">
                {appointment.service.name}
                {appointment.packageName ? (
                  <span className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                    <Package className="h-3 w-3" aria-hidden="true" />
                    {appointment.packageName}
                  </span>
                ) : null}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{ru.appointmentDialog.masterLabel}</span>
              <span className="font-medium">{appointment.master.name}</span>
            </div>

            <div className="flex items-center justify-between border-t pt-2.5">
              <span className="text-muted-foreground">{ru.appointmentDialog.priceLabel}</span>
              <span className="text-base font-bold text-foreground">
                {formatPriceKgs(appointment.price)}
              </span>
            </div>

            {(appointment.rescheduledCount ?? 0) > 0 && (
              <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                <span>Переносов клиентом:</span>
                <span className="font-medium text-foreground">{appointment.rescheduledCount}</span>
              </div>
            )}

            {appointment.cancelledBy && (
              <div className="space-y-1 border-t pt-2 text-xs text-destructive">
                <div className="flex items-center justify-between">
                  <span>Отменил:</span>
                  <span className="font-medium">
                    {appointment.cancelledBy === 'CLIENT'
                      ? 'Клиент'
                      : appointment.cancelledBy === 'SYSTEM'
                        ? 'Система (авто)'
                        : 'Персонал'}
                  </span>
                </div>
                {appointment.cancelReason && <div>Причина: {appointment.cancelReason}</div>}
              </div>
            )}
          </div>

          {/* Prepayment block */}
          {appointment.prepaymentStatus && appointment.prepaymentStatus !== 'NOT_REQUIRED' && (
            <div className="space-y-3 rounded-xl border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Предоплата</span>
                <PrepaymentStatusBadge status={appointment.prepaymentStatus} />
              </div>
              {appointment.prepaymentAmount && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Сумма:</span>
                  <span className="font-semibold">
                    {formatPriceKgs(appointment.prepaymentAmount)}
                  </span>
                </div>
              )}
              {appointment.prepaymentHoldUntil && appointment.prepaymentStatus === 'PENDING' && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Оплатить до:</span>
                  <span className="font-medium">
                    {formatDateInCompanyTz(appointment.prepaymentHoldUntil, timezone)}{' '}
                    {formatTimeInCompanyTz(appointment.prepaymentHoldUntil, timezone)}
                  </span>
                </div>
              )}
              {(appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') &&
                appointment.prepaymentStatus === 'PENDING' && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      disabled={isChangingStatus}
                      onClick={() => void handlePrepaymentAction('RECEIVED')}
                    >
                      Подтвердить получение
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isChangingStatus}
                      onClick={() => void handlePrepaymentAction('WAIVE')}
                    >
                      Снять требование
                    </Button>
                  </div>
                )}
              {callerRole === 'OWNER' && appointment.prepaymentStatus === 'RECEIVED' && (
                <div className="pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isChangingStatus}
                    onClick={() => void handlePrepaymentAction('REFUND')}
                  >
                    Возврат предоплаты
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {(appointment.clientNote || appointment.internalNote) && (
            <div className="space-y-2.5 rounded-xl border p-4 text-sm">
              {appointment.clientNote && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {ru.appointmentDialog.clientNoteLabel}
                  </p>
                  <p className="mt-0.5 text-foreground">{appointment.clientNote}</p>
                </div>
              )}
              {appointment.internalNote && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {ru.appointmentDialog.internalNoteLabel}
                  </p>
                  <p className="mt-0.5 text-foreground">{appointment.internalNote}</p>
                </div>
              )}
            </div>
          )}

          {/* Status transitions (BR-6 + Core Booking) */}
          {(appointment.status === 'SCHEDULED' ||
            appointment.status === 'CONFIRMED' ||
            appointment.status === 'IN_PROGRESS' ||
            (appointment.status === 'CANCELLED' && callerRole === 'OWNER')) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {ru.appointmentDialog.statusActionsLabel}
              </p>
              {appointment.status === 'CANCELLED' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isChangingStatus}
                  onClick={() => void handleStatusChange('SCHEDULED')}
                  className="w-full justify-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  {ru.appointmentDialog.markScheduled}
                </Button>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {appointment.status === 'SCHEDULED' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isChangingStatus}
                      onClick={() => void handleStatusChange('CONFIRMED')}
                      className="justify-start gap-2"
                    >
                      <Check className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                      {ru.appointmentDialog.markConfirmed}
                    </Button>
                  )}
                  {(appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isChangingStatus}
                      onClick={() => void handleStatusChange('IN_PROGRESS')}
                      className="justify-start gap-2"
                    >
                      <Play className="h-4 w-4 text-violet-600" aria-hidden="true" />
                      {ru.appointmentDialog.markInProgress}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={isChangingStatus}
                    onClick={() => void handleStatusChange('COMPLETED')}
                    className="justify-start gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    {ru.appointmentDialog.markCompleted}
                  </Button>
                  {(appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isChangingStatus}
                      onClick={() => void handleStatusChange('NO_SHOW')}
                      className="justify-start gap-2"
                    >
                      <UserX className="h-4 w-4 text-amber-600" aria-hidden="true" />
                      {ru.appointmentDialog.markNoShow}
                    </Button>
                  )}
                  {appointment.status === 'CONFIRMED' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isChangingStatus}
                      onClick={() => void handleStatusChange('SCHEDULED')}
                      className="justify-start gap-2"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      {ru.appointmentDialog.markScheduled}
                    </Button>
                  )}
                  {appointment.status === 'IN_PROGRESS' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isChangingStatus}
                      onClick={() => void handleStatusChange('CONFIRMED')}
                      className="justify-start gap-2"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      {ru.appointmentDialog.markConfirmed}
                    </Button>
                  )}
                  {(appointment.status !== 'IN_PROGRESS' ||
                    callerRole === 'OWNER' ||
                    callerRole === 'MANAGER') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isChangingStatus}
                      onClick={() => void handleStatusChange('CANCELLED')}
                      className="justify-start gap-2 text-destructive sm:col-span-2"
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      {ru.appointmentDialog.markCancelled}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="mt-6 space-y-3 border-t pt-4">
          {confirmDelete ? (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <p className="text-xs font-medium text-destructive">
                {ru.appointmentDialog.deleteConfirmText}
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setConfirmDelete(false)}
                  disabled={isDeleting}
                >
                  {ru.common.cancel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  onClick={() => void handleDelete()}
                  disabled={isDeleting}
                >
                  {isDeleting ? ru.common.deleting : ru.common.delete}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              {(appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onEdit(appointment)}
                  className="flex-1 gap-2"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {ru.common.edit}
                </Button>
              )}
              {callerRole === 'OWNER' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  aria-label={ru.common.delete}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

interface AppointmentFormDialogProps {
  open: boolean;
  editingAppointment: AppointmentDto | null;
  initialMasterId?: string;
  initialDate?: string;
  initialTime?: string;
  services: ServiceDto[];
  staffList: StaffDto[];
  timezone: string;
  callerRole: Role;
  callerUserId: string;
  onClose: () => void;
  onSaved: (saved: AppointmentDto) => void;
}

export function AppointmentFormDialog(props: AppointmentFormDialogProps) {
  if (!props.open) return null;
  const dialogKey = props.editingAppointment
    ? `edit-${props.editingAppointment.id}`
    : `new-${props.initialMasterId ?? 'any'}-${props.initialDate ?? 'today'}-${props.initialTime ?? '10:00'}`;
  return <AppointmentFormDialogInner key={dialogKey} {...props} />;
}

function AppointmentFormDialogInner({
  editingAppointment,
  initialMasterId,
  initialDate,
  initialTime,
  services,
  staffList,
  timezone,
  callerRole,
  callerUserId,
  onClose,
  onSaved,
}: AppointmentFormDialogProps) {
  const activeServices = useMemo(
    () => services.filter((s) => s.isActive || s.id === editingAppointment?.serviceId),
    [editingAppointment?.serviceId, services],
  );

  const bookableStaff = useMemo(
    () =>
      staffList.filter(
        (m) => (m.isActive && m.isBookable) || m.id === editingAppointment?.masterId,
      ),
    [editingAppointment?.masterId, staffList],
  );

  const initialParts = useMemo(
    () =>
      editingAppointment
        ? extractLocalDateAndTime(editingAppointment.startAt, timezone)
        : {
            date: initialDate ?? getTodayLocalDateInTz(timezone),
            time: initialTime ?? '10:00',
          },
    [editingAppointment, initialDate, initialTime, timezone],
  );

  const defaultService = activeServices[0];
  const defaultMasterId =
    callerRole === 'MASTER' ? callerUserId : (initialMasterId ?? bookableStaff[0]?.id ?? '');

  const [serviceId, setServiceId] = useState(
    () => editingAppointment?.serviceId ?? defaultService?.id ?? '',
  );
  const [extraServiceIds, setExtraServiceIds] = useState<string[]>(() =>
    (editingAppointment?.serviceIds ?? []).filter((id) => id !== editingAppointment?.serviceId),
  );
  const selectedServiceIds = useMemo(
    () => [serviceId, ...extraServiceIds],
    [serviceId, extraServiceIds],
  );
  const [packages, setPackages] = useState<ServicePackageDto[]>([]);
  const [packageId, setPackageId] = useState('');
  const selectedPackage = useMemo(
    () => packages.find((p) => p.id === packageId) ?? null,
    [packages, packageId],
  );

  function computeEffectivePrice(ids: string[], targetMasterId: string): string {
    const master = bookableStaff.find((m) => m.id === targetMasterId);
    const totalMinor = ids.reduce((sum, id) => {
      const override = master?.serviceOverrides?.find((o) => o.serviceId === id);
      const rawPrice = override?.customPrice ?? services.find((s) => s.id === id)?.price ?? '0';
      return sum + Math.round(Number(rawPrice) * 100);
    }, 0);
    return (totalMinor / 100).toFixed(2);
  }

  const [masterId, setMasterId] = useState(() => editingAppointment?.masterId ?? defaultMasterId);
  const [date, setDate] = useState(() => initialParts.date);
  const [time, setTime] = useState(() => initialParts.time);
  const [clientName, setClientName] = useState(() => editingAppointment?.clientName ?? '');
  const [clientPhone, setClientPhone] = useState(() => editingAppointment?.clientPhone ?? '');
  const [price, setPrice] = useState(() => {
    if (editingAppointment?.price) return editingAppointment.price;
    if (!defaultService) return '';
    return computeEffectivePrice([defaultService.id], defaultMasterId);
  });
  const [clientNote, setClientNote] = useState(() => editingAppointment?.clientNote ?? '');
  const [internalNote, setInternalNote] = useState(() => editingAppointment?.internalNote ?? '');

  const [availableSlots, setAvailableSlots] = useState<AvailableSlotDto[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(true);
  const [slotsRefreshKey, setSlotsRefreshKey] = useState(0);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clientSuggestions, setClientSuggestions] = useState<ClientListItemDto[]>([]);
  const [selectedClientBlocked, setSelectedClientBlocked] = useState(false);

  useEffect(() => {
    if (editingAppointment) return;
    let cancelled = false;
    void listServicePackages()
      .then((list) => {
        if (!cancelled) {
          setPackages(list.filter((p) => p.isActive));
        }
      })
      .catch(() => {
        if (!cancelled) setPackages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [editingAppointment]);

  useEffect(() => {
    if (editingAppointment) return;
    const q = clientPhone.trim() || clientName.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void listClients({ search: q, limit: 5 })
        .then((res) => {
          if (!cancelled) setClientSuggestions(res.items);
        })
        .catch(() => {
          if (!cancelled) setClientSuggestions([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clientName, clientPhone, editingAppointment]);

  // Filter masters that perform the selected service or package
  const eligibleMasters = useMemo(() => {
    if (callerRole === 'MASTER') {
      return bookableStaff.filter((m) => m.id === callerUserId);
    }
    if (selectedPackage) {
      return bookableStaff.filter((m) =>
        selectedPackage.serviceIds.every((id) => m.serviceIds.includes(id)),
      );
    }
    if (!serviceId) return bookableStaff;
    return bookableStaff.filter((m) => selectedServiceIds.every((id) => m.serviceIds.includes(id)));
  }, [bookableStaff, callerRole, callerUserId, selectedPackage, serviceId, selectedServiceIds]);

  // Fetch available slots whenever masterId, selection, date, or slotsRefreshKey changes
  useEffect(() => {
    if (!masterId || !date || (!selectedPackage && !serviceId)) {
      return;
    }

    let cancelled = false;

    async function loadSlots() {
      try {
        const res = selectedPackage
          ? await getStaffAvailability({
              masterId,
              packageId: selectedPackage.id,
              date,
            })
          : await getStaffAvailability({
              masterId,
              serviceId,
              serviceIds: selectedServiceIds,
              date,
            });
        if (!cancelled) {
          setAvailableSlots(res.slots);
        }
      } catch {
        if (!cancelled) {
          setAvailableSlots([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSlots(false);
        }
      }
    }

    void loadSlots();

    return () => {
      cancelled = true;
    };
  }, [date, masterId, selectedPackage, serviceId, selectedServiceIds, slotsRefreshKey]);

  function handlePackageChange(nextPackageId: string) {
    setPackageId(nextPackageId);
    setIsLoadingSlots(true);
    if (nextPackageId) {
      const pkg = packages.find((p) => p.id === nextPackageId);
      setExtraServiceIds([]);
      if (pkg) {
        setPrice(pkg.price);
      }
    } else if (serviceId) {
      setPrice(computeEffectivePrice([serviceId], masterId));
    }
  }

  function handleServiceChange(nextServiceId: string) {
    setIsLoadingSlots(true);
    setPackageId('');
    setServiceId(nextServiceId);
    setExtraServiceIds([]);
    if (nextServiceId) {
      setPrice(computeEffectivePrice([nextServiceId], masterId));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if ((!selectedPackage && !serviceId) || !masterId) {
      setFormError(ru.validation.required);
      return;
    }

    const trimmedClientName = clientName.trim();
    if (trimmedClientName.length < 2) {
      setFormError(ru.validation.nameMin);
      return;
    }

    const normalizedPhone = normalizePhoneE164OrNull(clientPhone);
    if (!normalizedPhone) {
      setFormError(ru.validation.phoneInvalid);
      return;
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
      setFormError(ru.validation.required);
      return;
    }

    const startAtIso = localDateTimeToUtcIso(date, time, timezone);

    setIsSubmitting(true);
    try {
      const baseFields = {
        masterId,
        startAt: startAtIso,
        clientName: trimmedClientName,
        clientPhone: normalizedPhone,
        clientNote: clientNote.trim().length > 0 ? clientNote.trim() : null,
        internalNote: internalNote.trim().length > 0 ? internalNote.trim() : null,
        ...(price.trim().length > 0 ? { price: price.trim() } : {}),
      };

      const saved = editingAppointment
        ? await updateAppointment(editingAppointment.id, {
            ...baseFields,
            serviceId,
            serviceIds: selectedServiceIds,
          })
        : await createAppointment(
            selectedPackage
              ? { ...baseFields, packageId: selectedPackage.id }
              : { ...baseFields, serviceId, serviceIds: selectedServiceIds },
          );

      toast.success(
        editingAppointment
          ? ru.appointmentDialog.updateSuccess
          : ru.appointmentDialog.createSuccess,
      );
      if (saved.warnings && saved.warnings.length > 0) {
        const warningLabels: Record<string, string> = {
          OUTSIDE_WORKING_HOURS: 'вне рабочих часов',
          DURING_BREAK: 'во время перерыва',
          DURING_TIME_OFF: 'в период отсутствия мастера',
        };
        toast.warning(
          `Обратите внимание: запись создана ${saved.warnings.map((w) => warningLabels[w] ?? w).join(', ')}.`,
        );
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      if (getApiErrorCode(err) === 'SLOT_ALREADY_BOOKED') {
        setIsLoadingSlots(true);
        setSlotsRefreshKey((k) => k + 1);
      }
      setFormError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <Card className="w-full shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <div>
            <DialogTitle id="appointment-form-dialog-title" className="text-lg">
              {editingAppointment
                ? ru.appointmentDialog.editTitle
                : ru.appointmentDialog.createTitle}
            </DialogTitle>
            <CardDescription>{timezone}</CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={ru.common.close}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardHeader>

        <CardContent className="pt-5">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {!editingAppointment && packages.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="appt-package">{ru.appointmentDialog.packageLabel}</Label>
                <select
                  id="appt-package"
                  value={packageId}
                  onChange={(e) => handlePackageChange(e.target.value)}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <option value="">{ru.appointmentDialog.packageSelectPlaceholder}</option>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} ({formatDurationMin(pkg.totalDurationMin)} •{' '}
                      {formatPriceKgs(pkg.price)})
                    </option>
                  ))}
                </select>
                {selectedPackage && (
                  <p className="text-xs text-muted-foreground">
                    Включает: {selectedPackage.items.map((item) => item.name).join(' + ')}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {!selectedPackage && (
                <div className="space-y-1.5">
                  <Label htmlFor="appt-service">{ru.appointmentDialog.serviceLabel}</Label>
                  <select
                    id="appt-service"
                    value={serviceId}
                    onChange={(e) => handleServiceChange(e.target.value)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {activeServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({formatDurationMin(s.durationMin)} • {formatPriceKgs(s.price)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={`space-y-1.5 ${selectedPackage ? 'sm:col-span-2' : ''}`}>
                <Label htmlFor="appt-master">{ru.appointmentDialog.masterLabel}</Label>
                <select
                  id="appt-master"
                  value={masterId}
                  onChange={(e) => {
                    const nextMasterId = e.target.value;
                    setIsLoadingSlots(true);
                    setMasterId(nextMasterId);
                    if (!selectedPackage) {
                      setPrice(computeEffectivePrice(selectedServiceIds, nextMasterId));
                    }
                  }}
                  disabled={callerRole === 'MASTER'}
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-2xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-70"
                >
                  {eligibleMasters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!selectedPackage && (
              <fieldset className="min-w-0 space-y-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">Дополнительные услуги</legend>
                {activeServices
                  .filter((service) => service.id !== serviceId)
                  .map((service) => (
                    <label key={service.id} className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-primary"
                        checked={extraServiceIds.includes(service.id)}
                        disabled={
                          !extraServiceIds.includes(service.id) && selectedServiceIds.length >= 10
                        }
                        onChange={() => {
                          const extras = extraServiceIds.includes(service.id)
                            ? extraServiceIds.filter((id) => id !== service.id)
                            : [...extraServiceIds, service.id];
                          setExtraServiceIds(extras);
                          setIsLoadingSlots(true);
                          setPrice(computeEffectivePrice([serviceId, ...extras], masterId));
                        }}
                      />
                      <span>
                        {service.name} · {formatDurationMin(service.durationMin)} ·{' '}
                        {formatPriceKgs(service.price)}
                      </span>
                    </label>
                  ))}
                <p className="text-sm text-muted-foreground">
                  Выбранные услуги выполняет один мастер подряд. Изменение состава пересчитает
                  стоимость.
                </p>
              </fieldset>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="appt-date">{ru.appointmentDialog.dateLabel}</Label>
                <Input
                  id="appt-date"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    if (e.target.value) {
                      setIsLoadingSlots(true);
                      setDate(e.target.value);
                    }
                  }}
                  className="min-h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="appt-time">{ru.appointmentDialog.manualTimeLabel}</Label>
                <Input
                  id="appt-time"
                  type="time"
                  step={300}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="min-h-11"
                />
              </div>
            </div>

            {/* Available slots strip */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {ru.appointmentDialog.availableSlotsLabel}
              </p>
              {isLoadingSlots ? (
                <p className="text-xs text-muted-foreground">{ru.common.loading}</p>
              ) : availableSlots.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {ru.appointmentDialog.noAvailableSlots}
                </p>
              ) : (
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {availableSlots.map((slot) => {
                    const isSelected = time === slot.label;
                    return (
                      <button
                        key={slot.startAt}
                        type="button"
                        onClick={() => setTime(slot.label)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'bg-background hover:bg-muted'
                        }`}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="appt-client-name">{ru.appointmentDialog.clientNameLabel}</Label>
                <Input
                  id="appt-client-name"
                  value={clientName}
                  onChange={(e) => {
                    setClientName(e.target.value);
                    setSelectedClientBlocked(false);
                  }}
                  placeholder={ru.appointmentDialog.clientNamePlaceholder}
                  className="min-h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="appt-client-phone">{ru.appointmentDialog.clientPhoneLabel}</Label>
                <Input
                  id="appt-client-phone"
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => {
                    setClientPhone(e.target.value);
                    setSelectedClientBlocked(false);
                  }}
                  placeholder={ru.appointmentDialog.clientPhonePlaceholder}
                  className="min-h-11"
                />
              </div>
            </div>

            {!editingAppointment && clientSuggestions.length > 0 && (
              <div className="rounded-lg border bg-muted/40 p-2 text-xs">
                <div className="mb-1 font-medium text-muted-foreground">Существующие клиенты:</div>
                <div className="flex flex-wrap gap-1.5">
                  {clientSuggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setClientName(c.name);
                        setClientPhone(c.phone);
                        setSelectedClientBlocked(c.isBlocked);
                        setClientSuggestions([]);
                      }}
                      className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 hover:bg-muted"
                    >
                      <span>{c.name}</span>
                      <span className="text-muted-foreground">({c.phone})</span>
                      {c.isBlocked && <Badge variant="destructive">Заблокирован</Badge>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedClientBlocked && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Внимание: этот клиент заблокирован для онлайн-записи, но вы можете создать запись
                вручную.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="appt-price">{ru.appointmentDialog.priceLabel}</Label>
              <Input
                id="appt-price"
                type="number"
                min={0}
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="min-h-11"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="appt-client-note">{ru.appointmentDialog.clientNoteLabel}</Label>
                <Input
                  id="appt-client-note"
                  value={clientNote}
                  onChange={(e) => setClientNote(e.target.value)}
                  placeholder={ru.appointmentDialog.clientNotePlaceholder}
                  className="min-h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="appt-internal-note">{ru.appointmentDialog.internalNoteLabel}</Label>
                <Input
                  id="appt-internal-note"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder={ru.appointmentDialog.internalNotePlaceholder}
                  className="min-h-11"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                {ru.common.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting} className="min-h-10">
                {isSubmitting ? ru.common.saving : ru.common.save}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </Dialog>
  );
}
