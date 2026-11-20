import { apiClient } from '@/lib/api/client';
import type {
  ApiSuccessEnvelope,
  PrepaymentMode,
  ServiceDto,
  ServicePackageDto,
} from '@/types/api';

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

export interface CreateServicePackagePayload {
  name: string;
  description?: string | null;
  price: number | string;
  serviceIds: string[];
  isActive?: boolean;
}

export interface UpdateServicePackagePayload {
  name?: string;
  description?: string | null;
  price?: number | string;
  serviceIds?: string[];
  isActive?: boolean;
}

export async function listServicePackages(): Promise<ServicePackageDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<ServicePackageDto[]>>('/services/packages');
  return res.data.data;
}

export async function createServicePackage(
  payload: CreateServicePackagePayload,
): Promise<ServicePackageDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<ServicePackageDto>>(
    '/services/packages',
    payload,
  );
  return res.data.data;
}

export async function updateServicePackage(
  id: string,
  payload: UpdateServicePackagePayload,
): Promise<ServicePackageDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<ServicePackageDto>>(
    `/services/packages/${id}`,
    payload,
  );
  return res.data.data;
}

export async function deleteServicePackage(id: string): Promise<void> {
  await apiClient.delete(`/services/packages/${id}`);
}
