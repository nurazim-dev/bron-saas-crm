import { apiClient, performSingleFlightRefresh } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth.store';
import type { ApiSuccessEnvelope, AuthSessionDto, BusinessType, MeResponseDto } from '@/types/api';

export interface RegisterOwnerPayload {
  companyName: string;
  businessType: BusinessType;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export async function registerOwner(payload: RegisterOwnerPayload): Promise<AuthSessionDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<AuthSessionDto>>('/auth/register', payload);
  const session = res.data.data;
  useAuthStore.getState().setSession(session);
  return session;
}

export async function loginWithPassword(payload: LoginPayload): Promise<AuthSessionDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<AuthSessionDto>>('/auth/login', payload);
  const session = res.data.data;
  useAuthStore.getState().setSession(session);
  return session;
}

export async function refreshSession(): Promise<AuthSessionDto> {
  return performSingleFlightRefresh();
}

export async function getMe(): Promise<MeResponseDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<MeResponseDto>>('/auth/me');
  const data = res.data.data;
  useAuthStore.getState().setUserAndCompany(data.user, data.company);
  return data;
}

export async function logoutSession(): Promise<void> {
  try {
    await apiClient.post('/auth/logout', {});
  } finally {
    useAuthStore.getState().clearSession();
  }
}

export async function changePassword(payload: ChangePasswordPayload): Promise<AuthSessionDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<AuthSessionDto>>('/auth/password', payload);
  const session = res.data.data;
  useAuthStore.getState().setSession(session);
  return session;
}
