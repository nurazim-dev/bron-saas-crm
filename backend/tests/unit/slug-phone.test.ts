import { describe, expect, it } from 'vitest';
import { normalizePhoneE164, sanitizeText } from '../../src/lib/phone.js';
import { generateUniqueCompanySlug, isValidSlug, slugifyCompanyName } from '../../src/lib/slug.js';

describe('lib/slug & lib/phone unit tests', () => {
  describe('slugifyCompanyName & generateUniqueCompanySlug (BR-9)', () => {
    it('transliterates Cyrillic company names to Latin lowercase slugs', () => {
      expect(slugifyCompanyName('Барбершоп Лорд')).toBe('barbershop-lord');
      expect(slugifyCompanyName('  Салон Красоты Айпери! ')).toBe('salon-krasoty-ayperi');
      expect(slugifyCompanyName('СТО Авто-Мастер 24/7')).toBe('sto-avto-master-24-7');
    });

    it('pads or defaults short names to at least 3 characters and caps at 40 characters', () => {
      expect(slugifyCompanyName('Я')).toBe('ya-kg');
      expect(slugifyCompanyName('!!!')).toBe('company');
      const longSlug = slugifyCompanyName('А'.repeat(60));
      expect(longSlug.length).toBeLessThanOrEqual(40);
      expect(isValidSlug(longSlug)).toBe(true);
    });

    it('appends a numeric suffix (-2, -3, ...) when the slug collides', async () => {
      const taken = new Set(['barbershop-lord', 'barbershop-lord-2']);
      const slug = await generateUniqueCompanySlug('Барбершоп Лорд', (candidate) =>
        Promise.resolve(taken.has(candidate)),
      );
      expect(slug).toBe('barbershop-lord-3');
    });
  });

  describe('normalizePhoneE164 & sanitizeText (BR-8)', () => {
    it('normalizes Kyrgyzstan local and international phone formats to E.164', () => {
      expect(normalizePhoneE164('0555123456')).toBe('+996555123456');
      expect(normalizePhoneE164('555123456')).toBe('+996555123456');
      expect(normalizePhoneE164('+996 555 123 456')).toBe('+996555123456');
      expect(normalizePhoneE164('0 (700) 99-88-77')).toBe('+996700998877');
    });

    it('rejects invalid phone numbers with 400 VALIDATION_ERROR', () => {
      expect(() => normalizePhoneE164('12345')).toThrowError(/Invalid phone number/);
      expect(() => normalizePhoneE164('not-a-phone')).toThrowError(/Invalid phone number/);
    });

    it('strips control characters and trims strings', () => {
      expect(sanitizeText('  Азамат\u0000\u0007\u001F Токтогулов \n')).toBe('Азамат Токтогулов');
    });
  });
});
