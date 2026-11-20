import { apiClient } from '@/lib/api/client';
import type {
  ApiSuccessEnvelope,
  Role,
  StaffDto,
  TelegramLinkCodeDto,
  WorkingHoursDto,
} from '@/types/api';

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
 * Fetches the company directory for OWNER and MANAGER, or the MASTER's own staff record.
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

export interface StaffServiceOverrideInput {
  serviceId: string;
  customPrice?: number | string | null;
  customDurationMin?: number | null;
}

export async function replaceStaffServices(
  id: string,
  serviceIds: string[],
  serviceOverrides?: StaffServiceOverrideInput[],
): Promise<StaffDto> {
  const res = await apiClient.put<ApiSuccessEnvelope<StaffDto>>(`/staff/${id}/services`, {
    serviceIds,
    ...(serviceOverrides ? { serviceOverrides } : {}),
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

export interface StaffPasswordResetLinkDto {
  url: string;
  expiresAt: string;
}

export async function createStaffPasswordResetLink(
  id: string,
  options: { sendEmail?: boolean } = {},
): Promise<StaffPasswordResetLinkDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<StaffPasswordResetLinkDto>>(
    `/staff/${id}/password-reset-link`,
    { sendEmail: Boolean(options.sendEmail) },
  );
  return res.data.data;
}

export async function createStaffTelegramLinkCode(id: string): Promise<TelegramLinkCodeDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<TelegramLinkCodeDto>>(
    `/staff/${id}/telegram-link-code`,
  );
  return res.data.data;
}

export async function unlinkStaffTelegram(id: string): Promise<void> {
  await apiClient.delete(`/staff/${id}/telegram`);
}
