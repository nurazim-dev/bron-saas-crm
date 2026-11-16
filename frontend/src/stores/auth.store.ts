import { create } from 'zustand';
import type { AuthSessionDto, AuthUserDto, CompanyDto } from '@/types/api';

export interface AuthState {
  accessToken: string | null;
  user: AuthUserDto | null;
  company: CompanyDto | null;
  isImpersonating: boolean;
  isInitialized: boolean;
  setSession: (session: AuthSessionDto & { isImpersonating?: boolean }) => void;
  setUserAndCompany: (user: AuthUserDto, company: CompanyDto) => void;
  setCompany: (company: CompanyDto) => void;
  clearSession: () => void;
  setInitialized: (initialized: boolean) => void;
}

/**
 * In-memory authentication store (§2.5).
 * Never persists accessToken to localStorage or sessionStorage.
 */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  company: null,
  isImpersonating: false,
  isInitialized: false,
  setSession: (session) =>
    set({
      accessToken: session.accessToken,
      user: session.user,
      company: session.company,
      isImpersonating: Boolean(session.isImpersonating),
      isInitialized: true,
    }),
  setUserAndCompany: (user, company) =>
    set({
      user,
      company,
    }),
  setCompany: (company) =>
    set({
      company,
    }),
  clearSession: () =>
    set({
      accessToken: null,
      user: null,
      company: null,
      isImpersonating: false,
      isInitialized: true,
    }),
  setInitialized: (initialized) =>
    set({
      isInitialized: initialized,
    }),
}));
