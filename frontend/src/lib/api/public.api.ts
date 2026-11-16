import axios from 'axios';
import { mapErrorCodeToRussian, ru } from '@/lib/i18n/ru';
import type {
  ApiErrorResponse,
  ApiSuccessEnvelope,
  AvailabilityDto,
  ErrorCode,
  PublicCompanyProfileDto,
  PublicCreateAppointmentResultDto,
  PublicPrepaymentBlockDto,
} from '@/types/api';

const publicHttpClient = axios.create({
  baseURL: '/api/v1/public',
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
});

export interface CreatePublicAppointmentPayload {
  serviceId: string;
  masterId?: string | null;
  startAt: string;
  clientName: string;
  clientPhone: string;
  clientNote?: string | null;
  consentAccepted: boolean;
  locale?: 'RU' | 'KY';
  website?: string;
}

/**
 * Server-side fetch helper for `/b/[slug]` SSR and `generateMetadata`.
 * Never caches (`cache: 'no-store'`).
 */
export async function fetchPublicCompanyServer(
  slug: string,
): Promise<PublicCompanyProfileDto | null> {
  const backendBase = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000';
  const encodedSlug = encodeURIComponent(slug);
  try {
    const res = await fetch(`${backendBase}/api/v1/public/companies/${encodedSlug}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as ApiSuccessEnvelope<PublicCompanyProfileDto>;
    return body.data;
  } catch {
    return null;
  }
}

export async function getPublicAvailability(
  slug: string,
  params: { masterId?: string; serviceId: string; date: string },
): Promise<AvailabilityDto> {
  const res = await publicHttpClient.get<ApiSuccessEnvelope<AvailabilityDto>>(
    `/companies/${encodeURIComponent(slug)}/availability`,
    {
      params: {
        ...params,
        _t: Date.now(),
      },
    },
  );
  return res.data.data;
}

export async function createPublicAppointment(
  slug: string,
  payload: CreatePublicAppointmentPayload,
): Promise<PublicCreateAppointmentResultDto> {
  const res = await publicHttpClient.post<ApiSuccessEnvelope<PublicCreateAppointmentResultDto>>(
    `/companies/${encodeURIComponent(slug)}/appointments`,
    payload,
  );
  return res.data.data;
}

export function getPublicErrorCode(err: unknown): ErrorCode | undefined {
  if (axios.isAxiosError<ApiErrorResponse>(err)) {
    return err.response?.data?.error?.code;
  }
  return undefined;
}

export type ManageDisableReason =
  'WINDOW_CLOSED' | 'NOT_SCHEDULED' | 'RESCHEDULE_DISABLED' | 'RESCHEDULE_LIMIT';

export interface PublicManageAppointmentDto {
  id: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  startAt: string;
  endAt: string;
  rescheduledCount: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  service: { id: string; name: string; durationMin: number; price: string };
  master: { id: string; name: string };
  company: {
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    timezone: string;
    currency: string;
    clientCancelMinHours: number;
    allowClientReschedule: boolean;
  };
  actions: {
    canCancel: boolean;
    cancelDisabledReason: ManageDisableReason | null;
    canReschedule: boolean;
    rescheduleDisabledReason: ManageDisableReason | null;
  };
  prepayment?: PublicPrepaymentBlockDto | null;
}

export async function getPublicManageAppointment(
  token: string,
): Promise<PublicManageAppointmentDto> {
  const res = await publicHttpClient.get<ApiSuccessEnvelope<PublicManageAppointmentDto>>(
    `/manage/${encodeURIComponent(token)}`,
  );
  return res.data.data;
}

export async function getPublicManageAvailability(
  token: string,
  date: string,
): Promise<AvailabilityDto> {
  const res = await publicHttpClient.get<ApiSuccessEnvelope<AvailabilityDto>>(
    `/manage/${encodeURIComponent(token)}/availability`,
    { params: { date } },
  );
  return res.data.data;
}

export async function cancelPublicManageAppointment(
  token: string,
  reason?: string | null,
): Promise<PublicManageAppointmentDto> {
  const res = await publicHttpClient.post<ApiSuccessEnvelope<PublicManageAppointmentDto>>(
    `/manage/${encodeURIComponent(token)}/cancel`,
    reason ? { reason } : {},
  );
  return res.data.data;
}

export async function reschedulePublicManageAppointment(
  token: string,
  startAt: string,
): Promise<PublicManageAppointmentDto> {
  const res = await publicHttpClient.post<ApiSuccessEnvelope<PublicManageAppointmentDto>>(
    `/manage/${encodeURIComponent(token)}/reschedule`,
    { startAt },
  );
  return res.data.data;
}

export function getPublicErrorMessage(err: unknown): string {
  if (axios.isAxiosError<ApiErrorResponse>(err)) {
    if (!err.response) {
      return ru.errors.NETWORK_ERROR;
    }
    const apiErr = err.response.data?.error;
    return mapErrorCodeToRussian(apiErr?.code, apiErr?.details);
  }
  return ru.errors.INTERNAL_ERROR;
}
