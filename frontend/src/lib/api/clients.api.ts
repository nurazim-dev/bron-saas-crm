import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope, AppointmentSource, AppointmentStatus } from '@/types/api';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface ClientTagDto {
  id: string;
  name: string;
  color: string;
  clientCount?: number;
}

export type ClientSegment =
  'ALL' | 'NEW' | 'REPEAT' | 'VIP' | 'AT_RISK' | 'LOST' | 'NO_SHOW_RISK' | 'BLOCKED';

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
  tags: ClientTagDto[];
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

export type ClientSortOption = 'lastVisit' | 'visits' | 'noShows' | 'name' | 'totalSpent';

export interface ListClientsQueryParams {
  search?: string;
  blocked?: 'true' | 'false';
  tagId?: string;
  segment?: ClientSegment;
  minVisits?: number;
  inactiveDays?: number;
  sort?: ClientSortOption;
  page?: number;
  limit?: number;
}

export async function listClients(
  params: ListClientsQueryParams,
): Promise<{ items: ClientListItemDto[]; meta: PaginationMeta }> {
  const res = await apiClient.get<
    ApiSuccessEnvelope<ClientListItemDto[]> & { meta: PaginationMeta }
  >('/clients', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export async function createClient(payload: {
  name: string;
  phone: string;
  notes?: string | null;
  tagIds?: string[];
}): Promise<ClientListItemDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<ClientListItemDto>>('/clients', payload);
  return res.data.data;
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

export async function listClientTags(): Promise<ClientTagDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<ClientTagDto[]>>('/clients/tags');
  return res.data.data;
}

export async function createClientTag(payload: {
  name: string;
  color?: string;
}): Promise<ClientTagDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<ClientTagDto>>('/clients/tags', payload);
  return res.data.data;
}

export async function updateClientTag(
  tagId: string,
  payload: { name?: string; color?: string },
): Promise<ClientTagDto> {
  const res = await apiClient.patch<ApiSuccessEnvelope<ClientTagDto>>(
    `/clients/tags/${tagId}`,
    payload,
  );
  return res.data.data;
}

export async function deleteClientTag(tagId: string): Promise<void> {
  await apiClient.delete(`/clients/tags/${tagId}`);
}

export async function setClientTags(clientId: string, tagIds: string[]): Promise<ClientTagDto[]> {
  const res = await apiClient.put<ApiSuccessEnvelope<ClientTagDto[]>>(`/clients/${clientId}/tags`, {
    tagIds,
  });
  return res.data.data;
}

export interface ClientMergePreviewDto {
  source: {
    id: string;
    name: string;
    phone: string;
    notes: string | null;
    isBlocked: boolean;
    totalAppointments: number;
    tags: ClientTagDto[];
  };
  target: {
    id: string;
    name: string;
    phone: string;
    notes: string | null;
    isBlocked: boolean;
    totalAppointments: number;
    tags: ClientTagDto[];
  };
  appointmentsToMove: number;
  resultingNotes: string | null;
  resultingIsBlocked: boolean;
  resultingTags: ClientTagDto[];
  warnings: string[];
}

export async function previewClientMerge(payload: {
  sourceClientId: string;
  targetClientId: string;
  notesStrategy?: 'CONCAT' | 'KEEP_TARGET' | 'KEEP_SOURCE';
}): Promise<ClientMergePreviewDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<ClientMergePreviewDto>>(
    '/clients/merge/preview',
    payload,
  );
  return res.data.data;
}

export async function executeClientMerge(payload: {
  sourceClientId: string;
  targetClientId: string;
  notesStrategy?: 'CONCAT' | 'KEEP_TARGET' | 'KEEP_SOURCE';
}) {
  const res = await apiClient.post<
    ApiSuccessEnvelope<{
      targetClientId: string;
      sourceClientId: string;
      movedAppointmentsCount: number;
      mergedTagsCount: number;
    }>
  >('/clients/merge', { ...payload, confirm: true });
  return res.data.data;
}

export type DuplicateImportStrategy = 'SKIP' | 'UPDATE_EMPTY' | 'MERGE_TAGS';

export interface ClientImportPreviewDto {
  totalRows: number;
  summary: {
    create: number;
    update: number;
    skip: number;
    error: number;
  };
  newTagsToCreate: string[];
  rows: Array<{
    rowNumber: number;
    name: string;
    phone: string;
    normalizedPhone: string | null;
    notes: string | null;
    tags: string[];
    action: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';
    reason?: string;
  }>;
}

export async function previewClientImport(payload: {
  csvText: string;
  duplicateStrategy?: DuplicateImportStrategy;
}): Promise<ClientImportPreviewDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<ClientImportPreviewDto>>(
    '/clients/import/preview',
    payload,
  );
  return res.data.data;
}

export async function executeClientImport(payload: {
  csvText: string;
  duplicateStrategy?: DuplicateImportStrategy;
}) {
  const res = await apiClient.post<
    ApiSuccessEnvelope<{
      totalRows: number;
      created: number;
      updated: number;
      skipped: number;
      errorCount: number;
      errors: Array<{ rowNumber: number; phone: string; reason: string }>;
    }>
  >('/clients/import', { ...payload, confirm: true });
  return res.data.data;
}

export async function downloadClientsCsv(
  params: Omit<ListClientsQueryParams, 'page' | 'limit' | 'sort'>,
): Promise<void> {
  const res = await apiClient.get<Blob>('/export/clients.csv', {
    params,
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'clients.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
