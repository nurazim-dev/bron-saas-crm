import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope, Role, StaffDto, WorkingHoursDto } from '@/types/api';

export interface CreateStaffPayload {
  name: string;
  phone?: string | null;
  email?: string;
  password?: string;
  isActive?: boolean;
  isBookable?: boolean;
}

export interface UpdateStaffPayload {
  name?: string;
  phone?: string | null;
  email?: string | null;
  password?: string;
  isActive?: boolean;
  isBookable?: boolean;
}

export async function listStaff(): Promise<StaffDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<StaffDto[]>>('/staff');
  return res.data.data;
}

export async function getStaff(id: string): Promise<StaffDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<StaffDto>>(`/staff/${id}`);
  return res.data.data;
}

/**
 * Fetches all company staff for OWNER (`GET /staff`), or only own staff record for MASTER (`GET /staff/:id`).
 */
export async function listVisibleStaffForRole(userId: string, role: Role): Promise<StaffDto[]> {
  if (role === 'MASTER') {
    const self = await getStaff(userId);
    return [self];
  }
  return listStaff();
}

export async function createStaff(payload: CreateStaffPayload): Promise<StaffDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<StaffDto>>('/staff', payload);
  return res.data.data;
}

export async function updateStaff(id: string, payload: UpdateStaffPayload): Promise<StaffDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<StaffDto>>(`/staff/${id}`, payload);
  return res.data.data;
}

export async function deleteStaff(id: string): Promise<void> {
  await apiClient.delete(`/staff/${id}`);
}

export async function replaceStaffServices(id: string, serviceIds: string[]): Promise<StaffDto> {
  const res = await apiClient.put<ApiSuccessEnvelope<StaffDto>>(`/staff/${id}/services`, {
    serviceIds,
  });
  return res.data.data;
}

export async function replaceStaffWorkingHours(
  id: string,
  days: WorkingHoursDto[],
): Promise<StaffDto> {
  const res = await apiClient.put<ApiSuccessEnvelope<StaffDto>>(`/staff/${id}/working-hours`, {
    days,
  });
  return res.data.data;
}
