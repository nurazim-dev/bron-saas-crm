import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope } from '@/types/api';

export type TimeOffKind = 'VACATION' | 'SICK_LEAVE' | 'OTHER';

export interface TimeOffDto {
  id: string;
  companyId: string;
  userId: string;
  userName?: string;
  startAt: string;
  endAt: string;
  kind: TimeOffKind;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeOffConflictsDto {
  count: number;
  appointmentIds: string[];
}

export async function listTimeOff(params?: {
  userId?: string;
  from?: string;
  to?: string;
}): Promise<TimeOffDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<TimeOffDto[]>>('/time-off', { params });
  return res.data.data;
}

export async function createTimeOff(payload: {
  userId?: string;
  kind: TimeOffKind;
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endAt?: string;
  note?: string | null;
}): Promise<{ data: TimeOffDto; conflicts: TimeOffConflictsDto }> {
  const res = await apiClient.post<
    ApiSuccessEnvelope<TimeOffDto> & { meta?: { conflicts?: TimeOffConflictsDto } }
  >('/time-off', payload);
  return {
    data: res.data.data,
    conflicts: res.data.meta?.conflicts ?? { count: 0, appointmentIds: [] },
  };
}

export async function deleteTimeOff(id: string): Promise<void> {
  await apiClient.delete(`/time-off/${id}`);
}
