import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { mapErrorCodeToRussian, ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';
import type { ApiErrorResponse, ApiSuccessEnvelope, AuthSessionDto } from '@/types/api';

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const AUTH_SKIP_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

function shouldSkipRefresh(url: string | undefined): boolean {
  if (!url) return false;
  return AUTH_SKIP_REFRESH_PATHS.some((path) => url.includes(path));
}

export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let inFlightRefreshPromise: Promise<AuthSessionDto> | null = null;

/**
 * Runs at most ONE shared in-flight token refresh request across all callers (§2.5).
 */
export async function performSingleFlightRefresh(): Promise<AuthSessionDto> {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = axios
    .post<ApiSuccessEnvelope<AuthSessionDto>>(
      '/api/v1/auth/refresh',
      {},
      {
        withCredentials: true,
        headers: { 'Content-Type': 'application/json' },
      },
    )
    .then((response) => {
      const session = response.data.data;
      useAuthStore.getState().setSession(session);
      return session;
    })
    .finally(() => {
      inFlightRefreshPromise = null;
    });

  return inFlightRefreshPromise;
}

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !shouldSkipRefresh(originalRequest.url)
    ) {
      originalRequest._retry = true;
      try {
        const refreshed = await performSingleFlightRefresh();
        originalRequest.headers.Authorization = `Bearer ${refreshed.accessToken}`;
        return await apiClient(originalRequest);
      } catch (refreshErr) {
        useAuthStore.getState().clearSession();
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  },
);

export function getApiErrorCode(err: unknown): ApiErrorResponse['error']['code'] | undefined {
  if (axios.isAxiosError<ApiErrorResponse>(err)) {
    return err.response?.data?.error?.code;
  }
  return undefined;
}

/**
 * Maps any API error to a localized Russian message via error.code (§2.4).
 * Never surfaces raw English backend messages to the user.
 */
export function getApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError<ApiErrorResponse>(err)) {
    if (!err.response) {
      return ru.errors.NETWORK_ERROR;
    }
    const apiErr = err.response.data?.error;
    return mapErrorCodeToRussian(apiErr?.code, apiErr?.details);
  }
  return ru.errors.INTERNAL_ERROR;
}
