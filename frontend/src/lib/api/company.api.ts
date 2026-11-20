import { apiClient } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth.store';
import type {
  ApiSuccessEnvelope,
  BusinessType,
  CompanyCapabilitiesDto,
  CompanyDto,
  LocaleCode,
  ReminderMode,
} from '@/types/api';

export interface UpdateCompanyPayload {
  name?: string;
  businessType?: BusinessType;
  phone?: string | null;
  address?: string | null;
  description?: string | null;
  brandColor?: string | null;
  customDomain?: string | null;
  instagramUrl?: string | null;
  timezone?: string;
  slug?: string;
  slotIntervalMin?: number;
  minLeadTimeMin?: number;
  maxAdvanceDays?: number;
  publicBookingEnabled?: boolean;
  clientCancelMinHours?: number;
  allowClientReschedule?: boolean;
  defaultLocale?: LocaleCode;
  reminderMode?: ReminderMode;
  remind24h?: boolean;
  remind2h?: boolean;
  paymentInstructions?: string | null;
  prepaymentHoldMin?: number;
}

export async function getCompanyCapabilities(): Promise<CompanyCapabilitiesDto> {
  const res =
    await apiClient.get<ApiSuccessEnvelope<CompanyCapabilitiesDto>>('/company/capabilities');
  return res.data.data;
}

export async function getCompany(): Promise<CompanyDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<CompanyDto>>('/company');
  const company = res.data.data;
  useAuthStore.getState().setCompany(company);
  return company;
}

export async function updateCompany(payload: UpdateCompanyPayload): Promise<CompanyDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<CompanyDto>>('/company', payload);
  const company = res.data.data;
  useAuthStore.getState().setCompany(company);
  return company;
}
