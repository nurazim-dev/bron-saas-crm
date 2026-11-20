import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope } from '@/types/api';

export interface AnalyticsRangeParams {
  from: string;
  to: string;
  masterId?: string;
}

export interface AnalyticsSummaryDto {
  period: { from: string; to: string; timezone: string };
  revenue: string;
  averageTicket: string;
  prepaymentsReceived: string;
  noShowRate: number;
  counts: {
    total: number;
    scheduled: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  clients: {
    newCount: number;
    returningCount: number;
  };
  sources: {
    online: number;
    staff: number;
  };
  deltas: {
    revenuePct: number | null;
    totalPct: number | null;
    completedPct: number | null;
    noShowRateDiff: number;
  };
}

export interface AnalyticsTimeseriesPointDto {
  date: string;
  revenue: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
}

export interface AnalyticsTimeseriesDto {
  granularity: 'day' | 'week' | 'month';
  points: AnalyticsTimeseriesPointDto[];
}

export interface AnalyticsServiceRowDto {
  serviceId: string;
  serviceName: string;
  revenue: string;
  total: number;
  completed: number;
}

export interface AnalyticsMasterRowDto {
  masterId: string;
  masterName: string;
  revenue: string;
  total: number;
  completed: number;
  noShow: number;
  availableMinutes: number;
  bookedMinutes: number;
  utilizationPct: number;
}

export interface AnalyticsHeatmapCellDto {
  weekday: number;
  hour: number;
  count: number;
}

export async function getAnalyticsSummary(
  params: AnalyticsRangeParams,
): Promise<AnalyticsSummaryDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<AnalyticsSummaryDto>>('/analytics/summary', {
    params,
  });
  return res.data.data;
}

export async function getAnalyticsTimeseries(
  params: AnalyticsRangeParams & { granularity?: 'day' | 'week' | 'month' },
): Promise<AnalyticsTimeseriesDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<AnalyticsTimeseriesDto>>(
    '/analytics/timeseries',
    { params },
  );
  return res.data.data;
}

export async function getAnalyticsServices(
  params: AnalyticsRangeParams,
): Promise<AnalyticsServiceRowDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<AnalyticsServiceRowDto[]>>(
    '/analytics/services',
    { params },
  );
  return res.data.data;
}

export async function getAnalyticsMasters(
  params: AnalyticsRangeParams,
): Promise<AnalyticsMasterRowDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<AnalyticsMasterRowDto[]>>(
    '/analytics/masters',
    { params },
  );
  return res.data.data;
}

export async function getAnalyticsHeatmap(
  params: AnalyticsRangeParams,
): Promise<AnalyticsHeatmapCellDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<AnalyticsHeatmapCellDto[]>>(
    '/analytics/heatmap',
    { params },
  );
  return res.data.data;
}

export interface AnalyticsCrmDto {
  period: { from: string; to: string; timezone: string };
  revenueBasis: 'COMPLETED_VISITS_ESTIMATE';
  segments: {
    totalActive: number;
    newClients: number;
    repeatClients: number;
    vipClients: number;
    atRiskClients: number;
    lostClients: number;
    noShowRiskClients: number;
    blockedClients: number;
  };
  retentionRate: number;
  repeatRate: number;
  topClients: Array<{
    id: string;
    name: string;
    phone: string;
    visits: number;
    completedValue: string;
    lastVisitAt: string | null;
    tags: Array<{ id: string; name: string; color: string }>;
  }>;
  byTag: Array<{
    tagId: string;
    name: string;
    color: string;
    clientCount: number;
    visitsInPeriod: number;
    completedValueInPeriod: string;
  }>;
}

export async function getAnalyticsCrm(params: AnalyticsRangeParams): Promise<AnalyticsCrmDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<AnalyticsCrmDto>>('/analytics/crm', {
    params,
  });
  return res.data.data;
}

export async function downloadAppointmentsCsv(params: AnalyticsRangeParams): Promise<void> {
  const res = await apiClient.get<Blob>('/export/appointments.csv', {
    params,
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `appointments-${params.from}-to-${params.to}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadPaymentsCsv(params: AnalyticsRangeParams): Promise<void> {
  const res = await apiClient.get<Blob>('/export/payments.csv', {
    params,
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payments-${params.from}-to-${params.to}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
