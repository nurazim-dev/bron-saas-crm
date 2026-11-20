import { apiClient } from '@/lib/api/client';
import type { ClientTagDto } from '@/lib/api/clients.api';
import type { ApiSuccessEnvelope, AppointmentStatus, Role } from '@/types/api';

export interface GlobalSearchResultDto {
  query: string;
  clients: Array<{
    id: string;
    name: string;
    phone: string;
    isBlocked: boolean;
    tags: ClientTagDto[];
  }>;
  appointments: Array<{
    id: string;
    clientId: string;
    clientName: string;
    clientPhone: string;
    startAt: string;
    status: AppointmentStatus;
    price: string;
    masterName: string;
    serviceName: string;
  }>;
  services: Array<{
    id: string;
    name: string;
    price: string;
    durationMin: number;
    isActive: boolean;
  }>;
  packages: Array<{
    id: string;
    name: string;
    price: string;
    isActive: boolean;
  }>;
  staff: Array<{
    id: string;
    name: string;
    role: Role;
    email: string | null;
    phone: string | null;
    isBookable: boolean;
  }>;
}

export async function globalSearch(q: string, limit = 5): Promise<GlobalSearchResultDto> {
  const res = await apiClient.get<ApiSuccessEnvelope<GlobalSearchResultDto>>('/search', {
    params: { q, limit },
  });
  return res.data.data;
}
