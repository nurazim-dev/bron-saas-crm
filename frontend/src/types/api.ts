export type Role = 'OWNER' | 'MASTER';

export type BusinessType = 'BEAUTY_SALON' | 'BARBERSHOP' | 'AUTO_SERVICE' | 'OTHER';

export type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type AppointmentSource = 'ONLINE' | 'STAFF';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'BOOKING_DISABLED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SLOT_ALREADY_BOOKED'
  | 'HAS_UPCOMING_APPOINTMENTS'
  | 'INVALID_STATUS_TRANSITION'
  | 'SLOT_NOT_AVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ErrorDetail {
  path?: string;
  message: string;
  upcomingAppointmentsCount?: number;
  [key: string]: unknown;
}

export interface ApiErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface AuthUserDto {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  isBookable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  slug: string;
  businessType: BusinessType;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  slotIntervalMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  publicBookingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionDto {
  accessToken: string;
  user: AuthUserDto;
  company: CompanyDto;
}

export interface MeResponseDto {
  user: AuthUserDto;
  company: CompanyDto;
}

export interface ServiceDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingHoursDto {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface StaffDto {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  isActive: boolean;
  isBookable: boolean;
  serviceIds: string[];
  workingHours: WorkingHoursDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentServiceSummaryDto {
  id: string;
  name: string;
  durationMin: number;
}

export interface AppointmentMasterSummaryDto {
  id: string;
  name: string;
}

export interface AppointmentDto {
  id: string;
  companyId: string;
  masterId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  clientNote: string | null;
  internalNote: string | null;
  startAt: string;
  endAt: string;
  price: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  service: AppointmentServiceSummaryDto;
  master: AppointmentMasterSummaryDto;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAppointmentsDto {
  data: AppointmentDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface AvailableSlotDto {
  startAt: string;
  label: string;
}

export interface AvailabilityDto {
  date: string;
  timezone: string;
  slots: AvailableSlotDto[];
}

export interface PublicCompanySummaryDto {
  name: string;
  slug: string;
  businessType: BusinessType;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  bookingEnabled: boolean;
  maxAdvanceDays: number;
}

export interface PublicServiceDto {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
}

export interface PublicMasterDto {
  id: string;
  name: string;
  serviceIds: string[];
}

export interface PublicCompanyProfileDto {
  company: PublicCompanySummaryDto;
  services: PublicServiceDto[];
  masters: PublicMasterDto[];
}

export interface PublicBookedAppointmentDto {
  id: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  service: {
    name: string;
    durationMin: number;
    price: string;
  };
  master: {
    name: string;
  };
  company: {
    name: string;
    address: string | null;
    phone: string | null;
    timezone: string;
  };
}

export interface PublicCreateAppointmentResultDto {
  appointment: PublicBookedAppointmentDto;
}
