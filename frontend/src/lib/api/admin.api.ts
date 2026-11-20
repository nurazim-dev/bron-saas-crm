import { adminApiClient, performAdminRefresh } from '@/lib/api/admin-client';
import { type AdminProfileDto, useAdminAuthStore } from '@/stores/admin-auth.store';
import type {
  ApiSuccessEnvelope,
  BusinessType,
  PaymentMethod,
  PaymentProofSummaryDto,
  PaymentStatus,
  PlanDto,
  Role,
  SubscriptionStatus,
} from '@/types/api';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export type AdminLoginResponse =
  | { status: 'authenticated'; accessToken: string; admin: AdminProfileDto }
  | { status: 'mfa_required' | 'enroll_required'; mfaToken: string };

export async function adminLogin(payload: {
  email: string;
  password: string;
}): Promise<AdminLoginResponse> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<AdminLoginResponse>>(
    '/auth/login',
    payload,
  );
  const data = res.data.data;
  if (data.status === 'authenticated') {
    useAdminAuthStore.getState().setSession({ accessToken: data.accessToken, admin: data.admin });
  }
  return data;
}

export async function adminVerifyMfa(payload: {
  mfaToken: string;
  code?: string;
  recoveryCode?: string;
}): Promise<{ accessToken: string; admin: AdminProfileDto }> {
  const res = await adminApiClient.post<
    ApiSuccessEnvelope<{ status: 'authenticated'; accessToken: string; admin: AdminProfileDto }>
  >('/auth/mfa', payload);
  const data = res.data.data;
  useAdminAuthStore.getState().setSession({ accessToken: data.accessToken, admin: data.admin });
  return { accessToken: data.accessToken, admin: data.admin };
}

export async function adminEnrollTotp(
  enrollOrAccessToken: string,
): Promise<{ secret: string; otpauthUrl: string }> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<{ secret: string; otpauthUrl: string }>>(
    '/auth/2fa/enroll',
    {},
    { headers: { Authorization: `Bearer ${enrollOrAccessToken}` } },
  );
  return res.data.data;
}

export async function adminVerifyEnrollTotp(
  enrollOrAccessToken: string,
  code: string,
): Promise<{ accessToken: string; admin: AdminProfileDto; recoveryCodes: string[] }> {
  const res = await adminApiClient.post<
    ApiSuccessEnvelope<{
      status: 'authenticated';
      accessToken: string;
      admin: AdminProfileDto;
      recoveryCodes: string[];
    }>
  >(
    '/auth/2fa/verify-enroll',
    { code },
    { headers: { Authorization: `Bearer ${enrollOrAccessToken}` } },
  );
  const data = res.data.data;
  useAdminAuthStore.getState().setSession({ accessToken: data.accessToken, admin: data.admin });
  return {
    accessToken: data.accessToken,
    admin: data.admin,
    recoveryCodes: data.recoveryCodes,
  };
}

export async function adminRefreshSession() {
  return performAdminRefresh();
}

export async function adminGetMe(): Promise<AdminProfileDto> {
  const res = await adminApiClient.get<ApiSuccessEnvelope<AdminProfileDto>>('/auth/me');
  useAdminAuthStore.getState().setAdmin(res.data.data);
  return res.data.data;
}

export async function adminLogout(): Promise<void> {
  try {
    await adminApiClient.post('/auth/logout', {});
  } finally {
    useAdminAuthStore.getState().clearSession();
  }
}

export interface AdminOverviewMetricsDto {
  totalCompanies: number;
  suspendedCount: number;
  companiesByState: Record<SubscriptionStatus, number>;
  signups7d: number;
  signups30d: number;
  mrr: string;
  confirmedPaymentsThisMonth: { count: number; amount: string };
  appointmentsLast30d: number;
  failedOutboxCount: number;
  pendingPaymentsCount: number;
}

export async function getAdminOverviewMetrics(): Promise<AdminOverviewMetricsDto> {
  const res =
    await adminApiClient.get<ApiSuccessEnvelope<AdminOverviewMetricsDto>>('/metrics/overview');
  return res.data.data;
}

export async function getAdminSignupsSeries(
  days = 14,
): Promise<Array<{ date: string; count: number }>> {
  const res = await adminApiClient.get<ApiSuccessEnvelope<Array<{ date: string; count: number }>>>(
    '/metrics/signups',
    { params: { days } },
  );
  return res.data.data;
}

export interface AdminCompanyListItem {
  id: string;
  name: string;
  slug: string;
  businessType: BusinessType;
  publicBookingEnabled: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
  deletedAt: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string | null; phone: string | null } | null;
  subscription: {
    state: SubscriptionStatus;
    isTrial: boolean;
    daysLeft: number;
    periodEndsAt: string;
    plan: { id: string; code: string; name: string };
  } | null;
  counts: { staff: number; appointments: number };
}

export interface AdminCompanyDetailDto extends Omit<AdminCompanyListItem, 'subscription'> {
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  staff: Array<{
    id: string;
    role: Role;
    name: string;
    email: string | null;
    phone: string | null;
    isActive: boolean;
    isBookable: boolean;
    createdAt: string;
  }>;
  subscription: {
    id: string;
    state: SubscriptionStatus;
    isTrial: boolean;
    daysLeft: number;
    periodStartsAt: string;
    periodEndsAt: string;
    graceEndsAt: string | null;
    plan: PlanDto;
  } | null;
  counts: { appointments: number; services: number; staff: number };
  lastActivityAt: string | null;
}

export async function listAdminCompanies(params: {
  search?: string;
  status?: SubscriptionStatus;
  plan?: string;
  businessType?: BusinessType;
  includeDeleted?: boolean;
  sortBy?: 'createdAt' | 'name' | 'periodEndsAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}): Promise<{ items: AdminCompanyListItem[]; meta: PaginationMeta }> {
  const res = await adminApiClient.get<
    ApiSuccessEnvelope<AdminCompanyListItem[]> & { meta: PaginationMeta }
  >('/companies', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export async function getAdminCompanyDetail(id: string): Promise<AdminCompanyDetailDto> {
  const res = await adminApiClient.get<ApiSuccessEnvelope<AdminCompanyDetailDto>>(
    `/companies/${id}`,
  );
  return res.data.data;
}

export async function updateAdminCompany(
  id: string,
  payload: {
    name?: string;
    slug?: string;
    businessType?: BusinessType;
    publicBookingEnabled?: boolean;
  },
): Promise<AdminCompanyDetailDto> {
  const res = await adminApiClient.patch<ApiSuccessEnvelope<AdminCompanyDetailDto>>(
    `/companies/${id}`,
    payload,
  );
  return res.data.data;
}

export async function suspendAdminCompany(
  id: string,
  reason: string,
): Promise<AdminCompanyDetailDto> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<AdminCompanyDetailDto>>(
    `/companies/${id}/suspend`,
    { reason },
  );
  return res.data.data;
}

export async function unsuspendAdminCompany(id: string): Promise<AdminCompanyDetailDto> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<AdminCompanyDetailDto>>(
    `/companies/${id}/unsuspend`,
    {},
  );
  return res.data.data;
}

export async function deleteAdminCompany(id: string, confirmSlug: string): Promise<void> {
  await adminApiClient.delete(`/companies/${id}`, { data: { confirmSlug } });
}

export async function restoreAdminCompany(id: string): Promise<AdminCompanyDetailDto> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<AdminCompanyDetailDto>>(
    `/companies/${id}/restore`,
    {},
  );
  return res.data.data;
}

export async function impersonateAdminCompany(
  id: string,
  reason: string,
): Promise<{ code: string; expiresAt: string }> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<{ code: string; expiresAt: string }>>(
    `/companies/${id}/impersonate`,
    { reason },
  );
  return res.data.data;
}

export async function adjustAdminCompanySubscription(
  id: string,
  payload: { planId?: string; periodEndsAt?: string; isTrial?: boolean; reason: string },
) {
  const res = await adminApiClient.put<ApiSuccessEnvelope<unknown>>(
    `/companies/${id}/subscription`,
    payload,
  );
  return res.data.data;
}

export async function recordAdminOfflinePayment(
  id: string,
  payload: {
    planId: string;
    months: 1 | 3 | 6 | 12;
    method: PaymentMethod;
    amount?: string;
    reference?: string;
    comment?: string;
    reason: string;
  },
) {
  const res = await adminApiClient.post<ApiSuccessEnvelope<unknown>>(
    `/companies/${id}/payments`,
    payload,
  );
  return res.data.data;
}

export interface AdminPaymentItem {
  id: string;
  company: { id: string; name: string; slug: string };
  plan: { id: string; code: string; name: string };
  status: PaymentStatus;
  amount: string;
  currency: string;
  months: number;
  method: PaymentMethod;
  reference: string | null;
  comment: string | null;
  rejectReason: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  source: string;
  reviewedAt: string | null;
  createdAt: string;
  proofs?: PaymentProofSummaryDto[];
}

export async function fetchAdminSubscriptionProofBlob(
  paymentId: string,
  proofId: string,
): Promise<Blob> {
  const res = await adminApiClient.get<Blob>(`/payments/${paymentId}/proofs/${proofId}`, {
    responseType: 'blob',
  });
  return res.data;
}

export async function listAdminPayments(params: {
  status?: PaymentStatus;
  companyId?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: AdminPaymentItem[]; meta: PaginationMeta }> {
  const res = await adminApiClient.get<
    ApiSuccessEnvelope<AdminPaymentItem[]> & { meta: PaginationMeta }
  >('/payments', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export async function confirmAdminPayment(id: string) {
  const res = await adminApiClient.post<ApiSuccessEnvelope<unknown>>(`/payments/${id}/confirm`, {});
  return res.data.data;
}

export async function rejectAdminPayment(id: string, reason: string) {
  const res = await adminApiClient.post<ApiSuccessEnvelope<unknown>>(`/payments/${id}/reject`, {
    reason,
  });
  return res.data.data;
}

export async function listAdminPlans(): Promise<PlanDto[]> {
  const res = await adminApiClient.get<ApiSuccessEnvelope<PlanDto[]>>('/plans');
  return res.data.data;
}

export async function createAdminPlan(payload: {
  code: string;
  name: string;
  description?: string | null;
  priceMonthly: string;
  maxStaff: number;
  maxServices?: number | null;
  maxAppointmentsPerMonth?: number | null;
  maxRemindersPerMonth?: number | null;
  featureAnalytics: boolean;
  featureAutoReminders: boolean;
  featurePrepayment: boolean;
  featureCrmAdvanced?: boolean;
  featureManualPayments?: boolean;
  featureMultiCompany?: boolean;
  featureCustomBranding?: boolean;
  isPublic: boolean;
  isLegacy?: boolean;
  sortOrder: number;
}): Promise<PlanDto> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<PlanDto>>('/plans', payload);
  return res.data.data;
}

export async function updateAdminPlan(
  id: string,
  payload: Partial<{
    name: string;
    description: string | null;
    priceMonthly: string;
    maxStaff: number;
    maxServices: number | null;
    maxAppointmentsPerMonth: number | null;
    maxRemindersPerMonth: number | null;
    featureAnalytics: boolean;
    featureAutoReminders: boolean;
    featurePrepayment: boolean;
    featureCrmAdvanced: boolean;
    featureManualPayments: boolean;
    featureMultiCompany: boolean;
    featureCustomBranding: boolean;
    isActive: boolean;
    isPublic: boolean;
    isLegacy: boolean;
    sortOrder: number;
  }>,
): Promise<PlanDto> {
  const res = await adminApiClient.patch<ApiSuccessEnvelope<PlanDto>>(`/plans/${id}`, payload);
  return res.data.data;
}

export interface AdminUserItem {
  id: string;
  company: { id: string; name: string; slug: string };
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  isBookable: boolean;
  hasLogin: boolean;
  createdAt: string;
}

export async function listAdminUsers(params: {
  search?: string;
  role?: Role;
  companyId?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: AdminUserItem[]; meta: PaginationMeta }> {
  const res = await adminApiClient.get<
    ApiSuccessEnvelope<AdminUserItem[]> & { meta: PaginationMeta }
  >('/users', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export async function deactivateAdminUser(id: string): Promise<void> {
  await adminApiClient.post(`/users/${id}/deactivate`, {});
}

export async function activateAdminUser(id: string): Promise<void> {
  await adminApiClient.post(`/users/${id}/activate`, {});
}

export async function revokeAdminUserSessions(id: string): Promise<void> {
  await adminApiClient.post(`/users/${id}/revoke-sessions`, {});
}

export async function createAdminUserPasswordResetLink(
  id: string,
  sendEmail = false,
): Promise<{ url: string; expiresAt: string }> {
  const res = await adminApiClient.post<ApiSuccessEnvelope<{ url: string; expiresAt: string }>>(
    `/users/${id}/password-reset-link`,
    { sendEmail },
  );
  return res.data.data;
}

export interface AdminOutboxItem {
  id: string;
  companyId: string | null;
  channel: string;
  kind: string;
  recipient: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  scheduledFor: string;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export async function listAdminOutbox(params: {
  status?: string;
  channel?: string;
  companyId?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: AdminOutboxItem[]; meta: PaginationMeta }> {
  const res = await adminApiClient.get<
    ApiSuccessEnvelope<AdminOutboxItem[]> & { meta: PaginationMeta }
  >('/outbox', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export async function retryAdminOutbox(id: string): Promise<void> {
  await adminApiClient.post(`/outbox/${id}/retry`, {});
}

export async function cancelAdminOutbox(id: string): Promise<void> {
  await adminApiClient.post(`/outbox/${id}/cancel`, {});
}

export interface AdminAuditItem {
  id: string;
  actorType: string;
  actorId: string | null;
  companyId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: string;
}

export async function listAdminAudit(params: {
  companyId?: string;
  actorType?: string;
  action?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: AdminAuditItem[]; meta: PaginationMeta }> {
  const res = await adminApiClient.get<
    ApiSuccessEnvelope<AdminAuditItem[]> & { meta: PaginationMeta }
  >('/audit', { params });
  return { items: res.data.data, meta: res.data.meta };
}

export interface AdminPlatformSettingsDto {
  trialDays: number;
  graceDays: number;
  trialPlanCode: string;
  registrationOpen: boolean;
  billingPaymentInstructions: string;
  supportPhone: string;
  supportWhatsapp: string;
  supportEmail: string;
  announcementEnabled: boolean;
  announcementText: string;
}

export async function getAdminSettings(): Promise<AdminPlatformSettingsDto> {
  const res = await adminApiClient.get<ApiSuccessEnvelope<AdminPlatformSettingsDto>>('/settings');
  return res.data.data;
}

export async function updateAdminSettings(
  payload: Partial<AdminPlatformSettingsDto>,
): Promise<AdminPlatformSettingsDto> {
  const res = await adminApiClient.put<ApiSuccessEnvelope<AdminPlatformSettingsDto>>(
    '/settings',
    payload,
  );
  return res.data.data;
}
