import { apiClient } from '@/lib/api/client';
import type {
  ApiSuccessEnvelope,
  AppointmentDto,
  AppointmentStatus,
  AvailabilityDto,
  PaginatedAppointmentsDto,
} from '@/types/api';

export interface ListAppointmentsParams {
  from: string;
  to: string;
  masterId?: string;
  status?: AppointmentStatus;
  page?: number;
  limit?: number;
}

export interface CreateAppointmentPayload {
  masterId: string;
  serviceId: string;
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
  startAt?: string;
  clientName?: string;
  clientPhone?: string;
  clientNote?: string | null;
  internalNote?: string | null;
  price?: string | number;
}

export async function listAppointments(
  params: ListAppointmentsParams,
): Promise<PaginatedAppointmentsDto> {
  const res = await apiClient.get<PaginatedAppointmentsDto>('/appointments', { params });
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

export async function deleteAppointment(id: string): Promise<void> {
  await apiClient.delete(`/appointments/${id}`);
}

export async function getStaffAvailability(params: {
  masterId: string;
  serviceId: string;
  date: string;
}): Promise<AvailabilityDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<AvailabilityDto>>('/availability', {
    params,
  });
  return res.data.data;
}
