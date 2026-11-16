'use client';

import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  MessageCircle,
  Pencil,
  Phone,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  changeAppointmentStatus,
  createAppointment,
  deleteAppointment,
  getStaffAvailability,
  updateAppointment,
} from '@/lib/api/appointments.api';
import { type ClientListItemDto, listClients } from '@/lib/api/clients.api';
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
  Role,
  ServiceDto,
  StaffDto,
} from '@/types/api';

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const styles: Record<AppointmentStatus, string> = {
    SCHEDULED: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appointment-details-title"
    >
      <div className="flex h-full w-full max-w-md flex-col justify-between overflow-y-auto border-l bg-background p-6 shadow-xl">
        <div className="space-y-5">
          <div className="flex items-start justify-between border-b pb-4">
            <div>
              <h2 id="appointment-details-title" className="text-lg font-bold">
                {ru.appointmentDialog.detailsTitle}
              </h2>
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
              <span className="font-medium">{appointment.service.name}</span>
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
          </div>

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

          {/* Status transitions (BR-6) */}
          {(appointment.status === 'SCHEDULED' ||
            (appointment.status === 'CANCELLED' && callerRole === 'OWNER')) && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {ru.appointmentDialog.statusActionsLabel}
              </p>
              {appointment.status === 'SCHEDULED' ? (
                <div className="grid gap-2 sm:grid-cols-2">
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
                </div>
              ) : (
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
              {appointment.status === 'SCHEDULED' && (
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
    </div>
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
  const [masterId, setMasterId] = useState(() => editingAppointment?.masterId ?? defaultMasterId);
  const [date, setDate] = useState(() => initialParts.date);
  const [time, setTime] = useState(() => initialParts.time);
  const [clientName, setClientName] = useState(() => editingAppointment?.clientName ?? '');
  const [clientPhone, setClientPhone] = useState(() => editingAppointment?.clientPhone ?? '');
  const [price, setPrice] = useState(
    () => editingAppointment?.price ?? defaultService?.price ?? '',
  );
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

  // Filter masters that perform the selected service (or fall back to all bookable staff if none assigned)
  const eligibleMasters = useMemo(() => {
    if (callerRole === 'MASTER') {
      return bookableStaff.filter((m) => m.id === callerUserId);
    }
    if (!serviceId) return bookableStaff;
    const withService = bookableStaff.filter((m) => m.serviceIds.includes(serviceId));
    return withService.length > 0 ? withService : bookableStaff;
  }, [bookableStaff, callerRole, callerUserId, serviceId]);

  // Fetch available slots whenever masterId, serviceId, date, or slotsRefreshKey changes
  useEffect(() => {
    if (!masterId || !serviceId || !date) {
      return;
    }

    let cancelled = false;

    async function loadSlots() {
      try {
        const res = await getStaffAvailability({ masterId, serviceId, date });
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
  }, [date, masterId, serviceId, slotsRefreshKey]);

  function handleServiceChange(nextServiceId: string) {
    setIsLoadingSlots(true);
    setServiceId(nextServiceId);
    const svc = services.find((s) => s.id === nextServiceId);
    if (svc && !editingAppointment) {
      setPrice(svc.price);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!serviceId || !masterId) {
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
      const payload = {
        masterId,
        serviceId,
        startAt: startAtIso,
        clientName: trimmedClientName,
        clientPhone: normalizedPhone,
        clientNote: clientNote.trim().length > 0 ? clientNote.trim() : null,
        internalNote: internalNote.trim().length > 0 ? internalNote.trim() : null,
        ...(price.trim().length > 0 ? { price: price.trim() } : {}),
      };

      const saved = editingAppointment
        ? await updateAppointment(editingAppointment.id, payload)
        : await createAppointment(payload);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appointment-form-dialog-title"
    >
      <Card className="max-h-[92vh] w-full max-w-xl overflow-y-auto shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <div>
            <CardTitle id="appointment-form-dialog-title" className="text-lg">
              {editingAppointment
                ? ru.appointmentDialog.editTitle
                : ru.appointmentDialog.createTitle}
            </CardTitle>
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

            <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="space-y-1.5">
                <Label htmlFor="appt-master">{ru.appointmentDialog.masterLabel}</Label>
                <select
                  id="appt-master"
                  value={masterId}
                  onChange={(e) => {
                    setIsLoadingSlots(true);
                    setMasterId(e.target.value);
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
    </div>
  );
}
