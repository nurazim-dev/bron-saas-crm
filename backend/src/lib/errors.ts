export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'ACCOUNT_LOCKED',
  'FORBIDDEN',
  'BOOKING_DISABLED',
  'BOOKING_NOT_ALLOWED',
  'NOT_FOUND',
  'CONFLICT',
  'SLOT_ALREADY_BOOKED',
  'HAS_UPCOMING_APPOINTMENTS',
  'INVALID_STATUS_TRANSITION',
  'SLOT_NOT_AVAILABLE',
  'CHANGE_NOT_ALLOWED',
  'INVALID_OR_EXPIRED_TOKEN',
  'SUBSCRIPTION_REQUIRED',
  'PLAN_LIMIT_REACHED',
  'FEATURE_NOT_IN_PLAN',
  'PAYMENT_INSTRUCTIONS_REQUIRED',
  'PAYMENT_CLAIM_PENDING',
  'ALREADY_REVIEWED',
  'REGISTRATION_CLOSED',
  'COMPANY_SUSPENDED',
  'IMPERSONATION_READ_ONLY',
  'SHARED_IDENTITY',
  'COMPANY_LIMIT_REACHED',
  'MFA_REQUIRED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetail {
  path?: string;
  message: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, httpStatus: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}
