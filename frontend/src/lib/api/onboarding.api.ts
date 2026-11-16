import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope, BusinessType } from '@/types/api';

export interface OnboardingStateDto {
  businessType: BusinessType;
  companySlug: string;
  steps: {
    profileComplete: boolean;
    hasServices: boolean;
    hasBookableMaster: boolean;
    linkShared: boolean;
  };
  completedCount: number;
  totalSteps: number;
  isCompleted: boolean;
  isDismissed: boolean;
  showChecklist: boolean;
}

export interface ServicePresetDto {
  id: string;
  businessType: BusinessType;
  name: string;
  durationMin: number;
  price: string;
}

export interface ApplyOnboardingPayload {
  phone?: string;
  address?: string;
  services?: Array<{
    presetId?: string;
    name?: string;
    durationMin: number;
    price: string | number;
  }>;
  ownerServesClients?: boolean;
  applyDefaultHours?: boolean;
  firstMaster?: {
    name: string;
    phone?: string;
  };
}

export async function getOnboardingState(): Promise<OnboardingStateDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<OnboardingStateDto>>('/onboarding');
  return res.data.data;
}

export async function getOnboardingPresets(): Promise<ServicePresetDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<ServicePresetDto[]>>('/onboarding/presets');
  return res.data.data;
}

export async function applyOnboarding(
  payload: ApplyOnboardingPayload,
): Promise<OnboardingStateDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<OnboardingStateDto>>(
    '/onboarding/apply',
    payload,
  );
  return res.data.data;
}

export async function dismissOnboarding(): Promise<OnboardingStateDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<OnboardingStateDto>>('/onboarding/dismiss');
  return res.data.data;
}

export async function markOnboardingLinkShared(): Promise<OnboardingStateDto> {
  const res =
    await apiClient.post<ApiSuccessEnvelope<OnboardingStateDto>>('/onboarding/link-shared');
  return res.data.data;
}
