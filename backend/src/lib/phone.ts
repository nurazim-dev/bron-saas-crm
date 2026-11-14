import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { AppError } from './errors.js';

/**
 * Strips control characters (ASCII 0x00-0x1F, 0x7F-0x9F) and trims whitespace (BR-8).
 */
export function sanitizeText(input: string): string {
  return input.replace(/\p{Cc}/gu, '').trim();
}

/**
 * Normalizes a phone number string to E.164 with default region 'KG' (BR-8).
 * Throws 400 VALIDATION_ERROR if invalid.
 */
export function normalizePhoneE164(rawPhone: string, fieldPath = 'phone'): string {
  const cleaned = sanitizeText(rawPhone);
  const parsed = parsePhoneNumberFromString(cleaned, 'KG');
  if (!parsed || !parsed.isValid()) {
    throw new AppError('VALIDATION_ERROR', 400, 'Invalid phone number', [
      {
        path: fieldPath,
        message: 'Phone number must be a valid phone number (e.g. +996555123456)',
      },
    ]);
  }
  return parsed.number;
}
