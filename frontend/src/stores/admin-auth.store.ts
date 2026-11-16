import { create } from 'zustand';

export interface AdminProfileDto {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminAuthState {
  accessToken: string | null;
  admin: AdminProfileDto | null;
  isInitialized: boolean;
  setSession: (session: { accessToken: string; admin: AdminProfileDto }) => void;
  setAdmin: (admin: AdminProfileDto) => void;
  clearSession: () => void;
  setInitialized: (initialized: boolean) => void;
}

export const useAdminAuthStore = create<AdminAuthState>((set) => ({
  accessToken: null,
  admin: null,
  isInitialized: false,
  setSession: (session) =>
    set({
      accessToken: session.accessToken,
      admin: session.admin,
      isInitialized: true,
    }),
  setAdmin: (admin) => set({ admin }),
  clearSession: () =>
    set({
      accessToken: null,
      admin: null,
      isInitialized: true,
    }),
  setInitialized: (initialized) => set({ isInitialized: initialized }),
}));
