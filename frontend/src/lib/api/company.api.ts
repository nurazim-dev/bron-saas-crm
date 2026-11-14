import { apiClient } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth.store';
import type { ApiSuccessEnvelope, BusinessType, CompanyDto } from '@/types/api';

export interface UpdateCompanyPayload {
  name?: string;
  businessType?: BusinessType;
  phone?: string | null;
  address?: string | null;
  timezone?: string;
  slug?: string;
  slotIntervalMin?: number;
  minLeadTimeMin?: number;
  maxAdvanceDays?: number;
  publicBookingEnabled?: boolean;
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
