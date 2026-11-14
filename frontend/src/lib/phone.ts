import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhoneE164OrNull(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, 'KG');
  if (!parsed || !parsed.isValid()) {
    return null;
  }
  return parsed.number;
}

export function isValidPhoneInput(raw: string): boolean {
  return normalizePhoneE164OrNull(raw) !== null;
}

export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '—';
  const parsed = parsePhoneNumberFromString(phone, 'KG');
  if (!parsed) return phone;
  return parsed.formatInternational();
}
