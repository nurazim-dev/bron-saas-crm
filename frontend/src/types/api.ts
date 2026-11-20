export type Role = 'OWNER' | 'MASTER' | 'MANAGER';

export type BusinessType = 'BARBERSHOP' | 'BEAUTY_SALON';

export type AppointmentStatus =
  'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

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
  | 'SHARED_IDENTITY'
  | 'COMPANY_LIMIT_REACHED'
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
  emailVerifiedAt?: string | null;
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
  description?: string | null;
  brandColor?: string | null;
  customDomain?: string | null;
  instagramUrl?: string | null;
  timezone: string;
  currency: string;
  slotIntervalMin: number;
  minLeadTimeMin: number;
  maxAdvanceDays: number;
  publicBookingEnabled: boolean;
  clientCancelMinHours?: number;
  allowClientReschedule?: boolean;
  defaultLocale?: 'RU' | 'KY' | 'EN';
  reminderMode?: 'OFF' | 'MANUAL' | 'AUTO';
  remind24h?: boolean;
  remind2h?: boolean;
  paymentInstructions?: string | null;
  prepaymentHoldMin?: number;
  createdAt: string;
  updatedAt: string;
}

export type PrepaymentMode = 'FIXED' | 'PERCENT';
export type PrepaymentStatus = 'NOT_REQUIRED' | 'PENDING' | 'RECEIVED' | 'REFUNDED';

export interface PublicPrepaymentBlockDto {
  status: PrepaymentStatus;
  amount: string | null;
  holdUntil: string | null;
  receivedAt: string | null;
  instructions: string | null;
  whatsappProofUrl: string | null;
}

export type ReminderMode = 'OFF' | 'MANUAL' | 'AUTO';
export type LocaleCode = 'RU' | 'KY' | 'EN';

export interface CompanyCapabilitiesDto {
  autoRemindersAvailable: boolean;
  clientMessageProvider: string;
  telegramConfigured: boolean;
  telegramBotUsername: string | null;
}

export interface InAppNotificationDto {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsListDto {
  items: InAppNotificationDto[];
  unreadCount: number;
}

export interface MyNotificationSettingsDto {
  notifyEmail: boolean;
  notifyTelegram: boolean;
  telegramConnected: boolean;
  telegramBotUsername: string | null;
}

export interface TelegramLinkCodeDto {
  code: string;
  expiresAt: string;
  deepLink: string | null;
}

export interface ManualReminderItemDto {
  id: string;
  clientName: string;
  clientPhone: string;
  clientLocale: LocaleCode;
  startAt: string;
  serviceName: string;
  masterName: string;
  whatsappUrl: string;
}

export interface ManualRemindersQueueDto {
  reminderMode: ReminderMode;
  items: ManualReminderItemDto[];
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

export interface CompanyMembershipDto {
  companyId: string;
  companyName: string;
  companySlug: string;
  businessType: BusinessType;
  role: Role;
  isCurrent: boolean;
  isSuspended: boolean;
}

export interface ServiceDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  durationMin: number;
  price: string;
  requiresPrepayment?: boolean;
  prepaymentMode?: PrepaymentMode | null;
  prepaymentValue?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServicePackageItemDto {
  serviceId: string;
  position: number;
  name: string;
  durationMin: number;
  price: string;
  isActive: boolean;
}

export interface ServicePackageDto {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  price: string;
  catalogTotalPrice: string;
  totalDurationMin: number;
  isActive: boolean;
  serviceIds: string[];
  items: ServicePackageItemDto[];
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

export interface StaffServiceOverrideDto {
  serviceId: string;
  customPrice: string | null;
  customDurationMin: number | null;
}

export interface StaffDto {
  id: string;
  companyId: string;
  role: Role;
  name: string;
  email: string | null;
  phone: string | null;
  hasLogin: boolean;
  telegramConnected?: boolean;
  notifyTelegram?: boolean;
  isActive: boolean;
  isBookable: boolean;
  serviceIds: string[];
  serviceOverrides?: StaffServiceOverrideDto[];
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
  serviceIds?: string[];
  packageId?: string | null;
  packageName?: string | null;
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
  cancelledBy?: 'CLIENT' | 'STAFF' | 'SYSTEM' | null;
  cancelReason?: string | null;
  rescheduledCount?: number;
  prepaymentStatus?: PrepaymentStatus;
  prepaymentAmount?: string | null;
  prepaymentHoldUntil?: string | null;
  prepaymentReceivedAt?: string | null;
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
  description?: string | null;
  brandColor?: string | null;
  customDomain?: string | null;
  instagramUrl?: string | null;
  defaultLocale?: LocaleCode;
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
  requiresPrepayment?: boolean;
  prepaymentAmount?: string | null;
}

export interface PublicServicePackageDto {
  id: string;
  name: string;
  description: string | null;
  price: string;
  catalogTotalPrice: string;
  totalDurationMin: number;
  serviceIds: string[];
  items: Array<{
    serviceId: string;
    name: string;
    durationMin: number;
    price: string;
  }>;
  requiresPrepayment?: boolean;
  prepaymentAmount?: string | null;
}

export interface PublicMasterServiceOverrideDto {
  serviceId: string;
  price: string;
  durationMin: number;
}

export interface PublicMasterDto {
  workingHours: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    breakStart: string | null;
    breakEnd: string | null;
  }[];
  biography: string;
  specialties: string;
  experienceYears: number | null;
  portfolio: {
    id: string;
    kind: string;
    caption: string;
    isCover: boolean;
    url: string;
    posterUrl: string;
  }[];
  id: string;
  name: string;
  serviceIds: string[];
  serviceOverrides?: PublicMasterServiceOverrideDto[];
}

export interface PublicCompanyProfileDto {
  company: PublicCompanySummaryDto;
  services: PublicServiceDto[];
  packages?: PublicServicePackageDto[];
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
  telegramBotUrl?: string;
  prepayment?: PublicPrepaymentBlockDto | null;
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
  description?: string | null;
  priceMonthly: string;
  currency: string;
  maxStaff: number;
  maxServices?: number | null;
  maxAppointmentsPerMonth?: number | null;
  maxRemindersPerMonth: number | null;
  featureAnalytics: boolean;
  featureAutoReminders: boolean;
  featurePrepayment: boolean;
  featureCrmAdvanced?: boolean;
  featureManualPayments?: boolean;
  featureMultiCompany?: boolean;
  featureCustomBranding?: boolean;
  isActive?: boolean;
  isPublic?: boolean;
  isLegacy?: boolean;
  sortOrder: number;
}

export interface PaymentProofSummaryDto {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  createdAt: string;
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
  proofs?: PaymentProofSummaryDto[];
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
    activeServicesCount: number;
    maxServices: number | null;
    isOverServicesLimit: boolean;
    monthlyAppointmentsCount: number;
    maxAppointmentsPerMonth: number | null;
    isOverAppointmentsLimit: boolean;
    monthlyRemindersCount: number;
    maxRemindersPerMonth: number | null;
    isOverRemindersLimit: boolean;
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
