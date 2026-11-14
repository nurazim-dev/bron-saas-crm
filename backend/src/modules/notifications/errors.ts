const MAX_ERROR_LENGTH = 500;

export class ProviderDeliveryError extends Error {
  readonly isPermanent: boolean;
  readonly code: string | undefined;

  constructor(message: string, isPermanent: boolean, code?: string) {
    super(message);
    this.name = 'ProviderDeliveryError';
    this.isPermanent = isPermanent;
    this.code = code;
  }
}

export function sanitizeProviderErrorMessage(raw: string): string {
  const redacted = raw
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/bot[0-9]+:[A-Za-z0-9_-]+/gi, 'bot[REDACTED]')
    .replace(/(password|token|secret)=([^&\s]+)/gi, '$1=[REDACTED]');

  return redacted.length > MAX_ERROR_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_LENGTH - 3)}...`
    : redacted;
}

export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 4) {
    return '***';
  }
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-3);
  return `${prefix}*****${suffix}`;
}

export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 1) {
    return '***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}

export function classifyProviderError(err: unknown): {
  isPermanent: boolean;
  sanitizedMessage: string;
} {
  if (err instanceof ProviderDeliveryError) {
    return {
      isPermanent: err.isPermanent,
      sanitizedMessage: sanitizeProviderErrorMessage(err.message),
    };
  }

  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    const message =
      typeof record.message === 'string' ? record.message : 'Unknown provider delivery error';
    const responseCode = typeof record.responseCode === 'number' ? record.responseCode : undefined;
    const code = typeof record.code === 'string' ? record.code : undefined;

    if (responseCode !== undefined && responseCode >= 500 && responseCode < 600) {
      return { isPermanent: false, sanitizedMessage: sanitizeProviderErrorMessage(message) };
    }
    if (code === 'EENVELOPE') {
      return { isPermanent: true, sanitizedMessage: sanitizeProviderErrorMessage(message) };
    }
    if (
      code === 'ECONNECTION' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ESOCKET'
    ) {
      return { isPermanent: false, sanitizedMessage: sanitizeProviderErrorMessage(message) };
    }
    if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) {
      return { isPermanent: false, sanitizedMessage: sanitizeProviderErrorMessage(message) };
    }

    return { isPermanent: false, sanitizedMessage: sanitizeProviderErrorMessage(message) };
  }

  return {
    isPermanent: false,
    sanitizedMessage: sanitizeProviderErrorMessage(String(err)),
  };
}
