import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { mapErrorCodeToRussian, ru } from '@/lib/i18n/ru';
import { useAuthStore } from '@/stores/auth.store';
import type { ApiErrorResponse, ApiSuccessEnvelope, AuthSessionDto } from '@/types/api';

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _tenantEpoch?: number;
}

const AUTH_SKIP_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

const AUTH_CONTEXT_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/switch-company',
  '/auth/companies',
  '/auth/impersonate/',
];

function shouldSkipRefresh(url: string | undefined): boolean {
  if (!url) return false;
  return AUTH_SKIP_REFRESH_PATHS.some((path) => url.includes(path));
}

function isAuthContextPath(url: string | undefined): boolean {
  if (!url) return false;
  return AUTH_CONTEXT_PATHS.some((path) => url.includes(path));
}

export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

let tenantEpoch = 0;
let tenantAbortController = new AbortController();
let inFlightRefreshPromise: Promise<AuthSessionDto> | null = null;

/**
 * Aborts all in-flight tenant-scoped requests and invalidates any pending responses/refreshes
 * from the previous company context so stale data can never surface after switching.
 */
export function resetTenantRequestContext(): void {
  tenantEpoch += 1;
  tenantAbortController.abort();
  tenantAbortController = new AbortController();
  inFlightRefreshPromise = null;
}

function combineAbortSignals(
  tenantSignal: AbortSignal,
  existingSignal: InternalAxiosRequestConfig['signal'],
): AbortSignal {
  if (!existingSignal) {
    return tenantSignal;
  }
  if (
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.any === 'function' &&
    existingSignal instanceof AbortSignal
  ) {
    return AbortSignal.any([tenantSignal, existingSignal]);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (tenantSignal.aborted || existingSignal.aborted) {
    controller.abort();
    return controller.signal;
  }
  tenantSignal.addEventListener('abort', abort, { once: true });
  if (typeof existingSignal.addEventListener === 'function') {
    existingSignal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

/**
 * Runs at most ONE shared in-flight token refresh request across all callers (§2.5).
 */
export async function performSingleFlightRefresh(): Promise<AuthSessionDto> {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  const refreshEpoch = tenantEpoch;
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
      if (refreshEpoch !== tenantEpoch) {
        throw new axios.CanceledError('Company context switched');
      }
      const session = response.data.data;
      useAuthStore.getState().setSession(session);
      return session;
    })
    .finally(() => {
      inFlightRefreshPromise = null;
    });

  return inFlightRefreshPromise;
}

apiClient.interceptors.request.use((config: RetryableRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (!isAuthContextPath(config.url)) {
    config._tenantEpoch = tenantEpoch;
    config.signal = combineAbortSignals(tenantAbortController.signal, config.signal);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    const requestConfig = response.config as RetryableRequestConfig | undefined;
    if (requestConfig?._tenantEpoch !== undefined && requestConfig._tenantEpoch !== tenantEpoch) {
      return Promise.reject(new axios.CanceledError('Company context switched'));
    }
    return response;
  },
  async (error: AxiosError<ApiErrorResponse>) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;

    if (
      originalRequest?._tenantEpoch !== undefined &&
      originalRequest._tenantEpoch !== tenantEpoch
    ) {
      return Promise.reject(new axios.CanceledError('Company context switched'));
    }

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
        if (axios.isCancel(refreshErr)) {
          return Promise.reject(refreshErr);
        }
        useAuthStore.getState().clearSession();
        return Promise.reject(refreshErr);
      }
    }

    if (error.response?.status === 402 && typeof window !== 'undefined') {
      const code = error.response.data?.error?.code;
      window.dispatchEvent(
        new CustomEvent('zapis:billing-402', {
          detail: { code },
        }),
      );
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
