export type Role = 'OWNER' | 'MASTER';

export type BusinessType = 'BARBERSHOP' | 'BEAUTY_SALON';

export type AppointmentStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type AppointmentSource = 'ONLINE' | 'STAFF';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'BOOKING_DISABLED'
  | 'BOOKING_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SLOT_ALREADY_BOOKED'
  | 'HAS_UPCOMING_APPOINTMENTS'
  | 'INVALID_STATUS_TRANSITION'
  | 'SLOT_NOT_AVAILABLE'
  | 'CHANGE_NOT_ALLOWED'
  | 'INVALID_OR_EXPIRED_TOKEN'
  | 'SUBSCRIPTION_REQUIRED'
  | 'PLAN_LIMIT_REACHED'
  | 'FEATURE_NOT_IN_PLAN'
  | 'PAYMENT_CLAIM_PENDING'
  | 'ALREADY_REVIEWED'
  | 'REGISTRATION_CLOSED'
  | 'COMPANY_SUSPENDED'
  | 'IMPERSONATION_READ_ONLY'
  | 'MFA_REQUIRED'
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
  clientCancelMinHours?: number;
  allowClientReschedule?: boolean;
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
  breakStart?: string | null;
  breakEnd?: string | null;
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
  clientId: string;
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
  cancelledAt?: string | null;
  cancelledBy?: 'CLIENT' | 'STAFF' | null;
  cancelReason?: string | null;
  rescheduledCount?: number;
  warnings?: Array<'OUTSIDE_WORKING_HOURS' | 'DURING_BREAK' | 'DURING_TIME_OFF'>;
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
    id?: string;
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
  manageUrl: string;
}

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'LOCKED';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export type PaymentMethod =
  'MBANK' | 'OPTIMA' | 'DEMIR' | 'BAKAI' | 'ELCART' | 'CASH' | 'BANK_TRANSFER' | 'OTHER';
export type PaymentSource = 'CLAIM' | 'ADMIN_MANUAL';

export interface PlanDto {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  currency: string;
  maxStaff: number;
  maxRemindersPerMonth: number | null;
  featureAnalytics: boolean;
  featureAutoReminders: boolean;
  featurePrepayment: boolean;
  isActive?: boolean;
  isPublic?: boolean;
  sortOrder: number;
}

export interface SubscriptionPaymentDto {
  id: string;
  companyId: string;
  planId: string;
  planCode: string;
  planName: string;
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
  source: PaymentSource;
  reviewedAt: string | null;
  createdAt: string;
}

export interface BillingOverviewDto {
  subscription: {
    id: string;
    state: SubscriptionStatus;
    isTrial: boolean;
    daysLeft: number;
    periodStartsAt: string;
    periodEndsAt: string;
    graceEndsAt: string;
    plan: PlanDto;
  };
  usage: {
    activeStaffCount: number;
    maxStaff: number;
    isOverStaffLimit: boolean;
  };
  pendingClaim: SubscriptionPaymentDto | null;
  paymentInstructions: string;
}

export interface PublicPlatformDto {
  plans: PlanDto[];
  support: {
    phone: string;
    whatsapp: string;
    email: string;
  };
  announcement: {
    enabled: boolean;
    text: string;
  };
  registrationOpen: boolean;
}
