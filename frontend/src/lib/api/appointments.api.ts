import { apiClient } from '@/lib/api/client';
import type {
  ApiSuccessEnvelope,
  AppointmentDto,
  AppointmentStatus,
  AvailabilityDto,
  PaginatedAppointmentsDto,
  PrepaymentStatus,
} from '@/types/api';

export interface ListAppointmentsParams {
  from: string;
  to: string;
  masterId?: string;
  status?: AppointmentStatus;
  prepaymentStatus?: PrepaymentStatus;
  page?: number;
  limit?: number;
}

export interface CreateAppointmentPayload {
  masterId: string;
  serviceId?: string;
  serviceIds?: string[];
  packageId?: string;
  startAt: string;
  clientName: string;
  clientPhone: string;
  clientNote?: string | null;
  internalNote?: string | null;
  price?: string | number;
}

export interface UpdateAppointmentPayload {
  masterId?: string;
  serviceId?: string;
  serviceIds?: string[];
  startAt?: string;
  clientName?: string;
  clientPhone?: string;
  clientNote?: string | null;
  internalNote?: string | null;
  price?: string | number;
}

export async function listAppointments(
  params: ListAppointmentsParams,
  signal?: AbortSignal,
): Promise<PaginatedAppointmentsDto> {
  const res = await apiClient.get<PaginatedAppointmentsDto>('/appointments', { params, signal });
  return res.data;
}

export async function getAppointment(id: string): Promise<AppointmentDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<AppointmentDto>>(`/appointments/${id}`);
  return res.data.data;
}

export async function createAppointment(
  payload: CreateAppointmentPayload,
): Promise<AppointmentDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<AppointmentDto>>('/appointments', payload);
  return res.data.data;
}

export async function updateAppointment(
  id: string,
  payload: UpdateAppointmentPayload,
): Promise<AppointmentDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<AppointmentDto>>(
    `/appointments/${id}`,
    payload,
  );
  return res.data.data;
}

export async function changeAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<AppointmentDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<AppointmentDto>>(
    `/appointments/${id}/status`,
    { status },
  );
  return res.data.data;
}

export async function applyPrepaymentAction(
  id: string,
  action: 'RECEIVED' | 'WAIVE' | 'REFUND',
): Promise<AppointmentDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<AppointmentDto>>(
    `/appointments/${id}/prepayment`,
    { action },
  );
  return res.data.data;
}

export async function deleteAppointment(id: string): Promise<void> {
  await apiClient.delete(`/appointments/${id}`);
}

export async function getStaffAvailability(params: {
  masterId: string;
  serviceId?: string;
  serviceIds?: string[];
  packageId?: string;
  date: string;
}): Promise<AvailabilityDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<AvailabilityDto>>('/availability', {
    params: { ...params, serviceIds: params.serviceIds?.join(',') },
  });
  return res.data.data;
}

// Calendar periods can exceed one API page. Never silently truncate the schedule.
export async function listCalendarAppointments(
  params: Pick<ListAppointmentsParams, 'from' | 'to'>,
  signal?: AbortSignal,
): Promise<AppointmentDto[]> {
  const first = await listAppointments({ ...params, page: 1, limit: 200 }, signal);
  const rows = [...first.data];
  for (let page = 2; page <= Math.ceil(first.meta.total / first.meta.limit); page += 1) {
    const next = await listAppointments({ ...params, page, limit: 200 }, signal);
    rows.push(...next.data);
  }
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}
