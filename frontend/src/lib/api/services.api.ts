import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope, PrepaymentMode, ServiceDto } from '@/types/api';

export interface CreateServicePayload {
  name: string;
  description?: string | null;
  durationMin: number;
  price: number | string;
  isActive?: boolean;
  requiresPrepayment?: boolean;
  prepaymentMode?: PrepaymentMode | null;
  prepaymentValue?: number | string | null;
}

export interface UpdateServicePayload {
  name?: string;
  description?: string | null;
  durationMin?: number;
  price?: number | string;
  isActive?: boolean;
  requiresPrepayment?: boolean;
  prepaymentMode?: PrepaymentMode | null;
  prepaymentValue?: number | string | null;
}

export async function listServices(): Promise<ServiceDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<ServiceDto[]>>('/services');
  return res.data.data;
}

export async function getService(id: string): Promise<ServiceDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<ServiceDto>>(`/services/${id}`);
  return res.data.data;
}

export async function createService(payload: CreateServicePayload): Promise<ServiceDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<ServiceDto>>('/services', payload);
  return res.data.data;
}

export async function updateService(
  id: string,
  payload: UpdateServicePayload,
): Promise<ServiceDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<ServiceDto>>(`/services/${id}`, payload);
  return res.data.data;
}

export async function deleteService(id: string): Promise<void> {
  await apiClient.delete(`/services/${id}`);
}
