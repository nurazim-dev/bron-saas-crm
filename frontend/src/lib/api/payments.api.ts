import { apiClient } from '@/lib/api/client';
import type { ApiSuccessEnvelope, PaymentMethod, PaymentProofSummaryDto } from '@/types/api';

export type BusinessPaymentKind = 'PAYMENT' | 'PREPAYMENT' | 'REFUND';
export type BusinessPaymentStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'VOIDED';

export interface BusinessPaymentDto {
  id: string;
  companyId: string;
  appointmentId: string | null;
  clientId: string | null;
  kind: BusinessPaymentKind;
  status: BusinessPaymentStatus;
  amount: string;
  currency: string;
  method: PaymentMethod;
  providerCode: string;
  reference: string | null;
  note: string | null;
  rejectReason: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  client: { id: string; name: string; phone: string } | null;
  appointment: {
    id: string;
    startAt: string;
    price: string;
    status: string;
    serviceName: string;
  } | null;
  proofs: PaymentProofSummaryDto[];
}

export interface BusinessPaymentsSummaryDto {
  period: { from: string; to: string; timezone: string };
  currency: string;
  confirmedPayments: string;
  confirmedRefunds: string;
  netConfirmedRevenue: string;
  pendingAmount: string;
  pendingCount: number;
  completedAppointmentsEstimate: string;
  byMethod: Array<{
    method: PaymentMethod;
    confirmedPayments: string;
    confirmedRefunds: string;
    netAmount: string;
  }>;
}

export interface ListBusinessPaymentsParams {
  status?: BusinessPaymentStatus;
  kind?: BusinessPaymentKind;
  method?: PaymentMethod;
  appointmentId?: string;
  clientId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function listBusinessPayments(params: ListBusinessPaymentsParams = {}): Promise<{
  items: BusinessPaymentDto[];
  meta: { page: number; limit: number; total: number };
}> {
  const res = await apiClient.get<
    ApiSuccessEnvelope<BusinessPaymentDto[]> & {
      meta: { page: number; limit: number; total: number };
    }
  >('/payments', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export async function getBusinessPaymentsSummary(params: {
  from: string;
  to: string;
}): Promise<BusinessPaymentsSummaryDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<BusinessPaymentsSummaryDto>>(
    '/payments/summary',
    { params },
  );
  return res.data.data;
}

export async function createBusinessPayment(payload: {
  appointmentId?: string;
  clientId?: string;
  kind?: BusinessPaymentKind;
  amount: string | number;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  confirmImmediately?: boolean;
}): Promise<BusinessPaymentDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<BusinessPaymentDto>>('/payments', payload);
  return res.data.data;
}

export async function confirmBusinessPayment(id: string): Promise<BusinessPaymentDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<BusinessPaymentDto>>(
    `/payments/${id}/confirm`,
  );
  return res.data.data;
}

export async function rejectBusinessPayment(
  id: string,
  reason: string,
): Promise<BusinessPaymentDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<BusinessPaymentDto>>(
    `/payments/${id}/reject`,
    { reason },
  );
  return res.data.data;
}

export async function uploadBusinessPaymentProof(
  paymentId: string,
  file: File,
): Promise<PaymentProofSummaryDto> {
  const buffer = await file.arrayBuffer();
  const res = await apiClient.post<ApiSuccessEnvelope<PaymentProofSummaryDto>>(
    `/payments/${paymentId}/proofs`,
    buffer,
    {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
    },
  );
  return res.data.data;
}

export async function fetchBusinessPaymentProofBlob(
  paymentId: string,
  proofId: string,
): Promise<Blob> {
  const res = await apiClient.get<Blob>(`/payments/${paymentId}/proofs/${proofId}`, {
    responseType: 'blob',
  });
  return res.data;
}
