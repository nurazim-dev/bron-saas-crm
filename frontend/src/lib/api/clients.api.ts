import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope, AppointmentSource, AppointmentStatus } from '@/types/api';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ClientStatsDto {
  visits: number;
  noShows: number;
  cancellations: number;
  totalSpent: string;
  lastVisitAt: string | null;
  nextAppointmentAt: string | null;
  firstSeenAt: string;
}

export interface ClientListItemDto {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  isBlocked: boolean;
  blockedAt: string | null;
  anonymizedAt: string | null;
  createdAt: string;
  stats: ClientStatsDto;
}

export interface ClientDetailDto {
  client: ClientListItemDto & { locale: 'RU' | 'KY' };
  appointments: Array<{
    id: string;
    startAt: string;
    endAt: string;
    price: string;
    status: AppointmentStatus;
    source: AppointmentSource;
    clientNote: string | null;
    internalNote: string | null;
    master: { id: string; name: string };
    service: { id: string; name: string; durationMin: number };
  }>;
  meta: PaginationMeta;
}

export type ClientSortOption = 'lastVisit' | 'visits' | 'noShows' | 'name';

export async function listClients(params: {
  search?: string;
  blocked?: 'true' | 'false';
  sort?: ClientSortOption;
  page?: number;
  limit?: number;
}): Promise<{ items: ClientListItemDto[]; meta: PaginationMeta }> {
  const res = await apiClient.get<
    ApiSuccessEnvelope<ClientListItemDto[]> & { meta: PaginationMeta }
  >('/clients', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export async function getClientDetail(
  id: string,
  params?: { page?: number; limit?: number },
): Promise<ClientDetailDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<ClientDetailDto>>(`/clients/${id}`, {
    params,
  });
  return res.data.data;
}

export async function updateClient(
  id: string,
  payload: { name?: string; notes?: string | null; isBlocked?: boolean },
) {
  const res = await apiClient.patch<ApiSuccessEnvelope<ClientListItemDto>>(
    `/clients/${id}`,
    payload,
  );
  return res.data.data;
}

export async function anonymizeClient(id: string) {
  const res = await apiClient.post<ApiSuccessEnvelope<{ id: string; name: string; phone: string }>>(
    `/clients/${id}/anonymize`,
    { confirm: true },
  );
  return res.data.data;
}
