import { apiClient } from '@/lib/api/client';
import type {
  ApiSuccessEnvelope,
  BillingOverviewDto,
  PaymentMethod,
  PaymentProofSummaryDto,
  PlanDto,
  PublicPlatformDto,
  SubscriptionPaymentDto,
} from '@/types/api';

export interface BillingPaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export async function getBillingOverview(): Promise<BillingOverviewDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<BillingOverviewDto>>('/billing');
  return res.data.data;
}

export async function listBillingPlans(): Promise<PlanDto[]> {
  const res = await apiClient.get<ApiSuccessEnvelope<PlanDto[]>>('/billing/plans');
  return res.data.data;
}

export async function listBillingPayments(
  page = 1,
  limit = 20,
): Promise<{ items: SubscriptionPaymentDto[]; meta: BillingPaginationMeta }> {
  const res = await apiClient.get<
    ApiSuccessEnvelope<SubscriptionPaymentDto[]> & { meta: BillingPaginationMeta }
  >('/billing/payments', { params: { page, limit } });
  return {
    items: res.data.data,
    meta: res.data.meta ?? { page, limit, total: res.data.data.length },
  };
}

export interface CreatePaymentClaimPayload {
  planId: string;
  months: 1 | 3 | 6 | 12;
  method: PaymentMethod;
  reference?: string;
  comment?: string;
}

export async function createPaymentClaim(
  payload: CreatePaymentClaimPayload,
): Promise<SubscriptionPaymentDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<SubscriptionPaymentDto>>(
    '/billing/payments',
    payload,
  );
  return res.data.data;
}

export async function cancelPaymentClaim(paymentId: string): Promise<SubscriptionPaymentDto> {
  const res = await apiClient.delete<ApiSuccessEnvelope<SubscriptionPaymentDto>>(
    `/billing/payments/${paymentId}`,
  );
  return res.data.data;
}

export async function switchToFreePlan(): Promise<BillingOverviewDto> {
  const res = await apiClient.post<ApiSuccessEnvelope<BillingOverviewDto>>('/billing/switch-free');
  return res.data.data;
}

export async function getPublicPlatform(): Promise<PublicPlatformDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<PublicPlatformDto>>('/public/platform');
  return res.data.data;
}

export async function uploadSubscriptionPaymentProof(
  paymentId: string,
  file: File,
): Promise<PaymentProofSummaryDto> {
  const buffer = await file.arrayBuffer();
  const res = await apiClient.post<ApiSuccessEnvelope<PaymentProofSummaryDto>>(
    `/billing/payments/${paymentId}/proofs`,
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

export async function fetchSubscriptionPaymentProofBlob(
  paymentId: string,
  proofId: string,
): Promise<Blob> {
  const res = await apiClient.get<Blob>(`/billing/payments/${paymentId}/proofs/${proofId}`, {
    responseType: 'blob',
  });
  return res.data;
}
