import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { type AdminProfileDto, useAdminAuthStore } from '@/stores/admin-auth.store';
import type { ApiErrorResponse, ApiSuccessEnvelope } from '@/types/api';

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const ADMIN_SKIP_REFRESH = ['/auth/login', '/auth/mfa', '/auth/refresh', '/auth/logout'];

function shouldSkipRefresh(url: string | undefined): boolean {
  if (!url) return false;
  return ADMIN_SKIP_REFRESH.some((path) => url.includes(path));
}

export const adminApiClient = axios.create({
  baseURL: '/api/v1/admin',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let inFlightAdminRefresh: Promise<{ accessToken: string; admin: AdminProfileDto }> | null = null;

export async function performAdminRefresh(): Promise<{
  accessToken: string;
  admin: AdminProfileDto;
}> {
  if (inFlightAdminRefresh) {
    return inFlightAdminRefresh;
  }

  inFlightAdminRefresh = axios
    .post<ApiSuccessEnvelope<{ accessToken: string; admin: AdminProfileDto }>>(
      '/api/v1/admin/auth/refresh',
      {},
      {
        withCredentials: true,
        headers: { 'Content-Type': 'application/json' },
      },
    )
    .then((response) => {
      const session = response.data.data;
      useAdminAuthStore.getState().setSession(session);
      return session;
    })
    .finally(() => {
      inFlightAdminRefresh = null;
    });

  return inFlightAdminRefresh;
}

adminApiClient.interceptors.request.use((config) => {
  const token = useAdminAuthStore.getState().accessToken;
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

adminApiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const originalRequest = error.config as RetryableConfig | undefined;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !shouldSkipRefresh(originalRequest.url) &&
      !originalRequest.headers.Authorization?.toString().includes('enroll')
    ) {
      originalRequest._retry = true;
      try {
        const refreshed = await performAdminRefresh();
        originalRequest.headers.Authorization = `Bearer ${refreshed.accessToken}`;
        return await adminApiClient(originalRequest);
      } catch (refreshErr) {
        useAdminAuthStore.getState().clearSession();
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  },
);
