import axios from 'axios';
import type { PublicLang } from '@/lib/i18n/public-dict';
import { mapErrorCodeToRussian, ru } from '@/lib/i18n/ru';
import type {
  ApiErrorResponse,
  ApiSuccessEnvelope,
  AppointmentStatus,
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
  serviceId?: string;
  serviceIds?: string[];
  packageId?: string;
  masterId?: string | null;
  startAt: string;
  clientName: string;
  clientPhone: string;
  clientNote?: string | null;
  consentAccepted: boolean;
  locale?: 'RU' | 'KY' | 'EN';
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
  params: {
    masterId?: string;
    serviceId?: string;
    serviceIds?: string[];
    packageId?: string;
    date: string;
  },
): Promise<AvailabilityDto> {
  const res = await publicHttpClient.get<ApiSuccessEnvelope<AvailabilityDto>>(
    `/companies/${encodeURIComponent(slug)}/availability`,
    {
      params: {
        ...params,
        serviceIds: params.serviceIds?.join(','),
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
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  rescheduledCount: number;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  packageName?: string | null;
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
  telegramBotUrl?: string;
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

export function getPublicErrorMessage(err: unknown, lang: PublicLang = 'ru'): string {
  if (lang === 'ky') {
    const code = getPublicErrorCode(err);
    if (code === 'RATE_LIMITED') return 'Сурамдар өтө көп. Бир аз күтүп, кайра аракет кылыңыз.';
    if (code === 'SLOT_ALREADY_BOOKED' || code === 'SLOT_NOT_AVAILABLE')
      return 'Бул убакыт бош эмес. Башка убакытты тандаңыз.';
    if (code === 'VALIDATION_ERROR') return 'Киргизилген маалыматтарды текшериңиз.';
    if (code === 'BOOKING_DISABLED' || code === 'BOOKING_NOT_ALLOWED')
      return 'Онлайн жазылуу жеткиликсиз. Салон менен байланышыңыз.';
    if (code === 'INVALID_OR_EXPIRED_TOKEN' || code === 'NOT_FOUND')
      return 'Шилтеме жараксыз же жазылуу табылган жок.';
    return 'Сурам аткарылган жок. Байланышты текшерип, кайра аракет кылыңыз.';
  }
  if (lang === 'en') {
    const code = getPublicErrorCode(err);
    if (code === 'RATE_LIMITED') return 'Too many requests. Please wait and try again.';
    if (code === 'SLOT_ALREADY_BOOKED' || code === 'SLOT_NOT_AVAILABLE')
      return 'This time slot is no longer available. Please choose another.';
    if (code === 'VALIDATION_ERROR') return 'Please check the entered details.';
    if (code === 'BOOKING_DISABLED' || code === 'BOOKING_NOT_ALLOWED')
      return 'Online booking is unavailable. Please contact the salon.';
    if (code === 'INVALID_OR_EXPIRED_TOKEN' || code === 'NOT_FOUND')
      return 'Invalid link or appointment not found.';
    return 'Request failed. Please check your connection and try again.';
  }
  if (axios.isAxiosError<ApiErrorResponse>(err)) {
    if (!err.response) {
      return ru.errors.NETWORK_ERROR;
    }
    const apiErr = err.response.data?.error;
    return mapErrorCodeToRussian(apiErr?.code, apiErr?.details);
  }
  return ru.errors.INTERNAL_ERROR;
}
