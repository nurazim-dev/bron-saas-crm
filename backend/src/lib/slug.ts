const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Kyrgyz specific letters
  ң: 'n',
  ө: 'o',
  ү: 'u',
};

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

export function isValidSlug(slug: string): boolean {
  return slug.length >= SLUG_MIN_LENGTH && slug.length <= SLUG_MAX_LENGTH && SLUG_REGEX.test(slug);
}

/**
 * Transliterates Cyrillic (Russian + Kyrgyz) and Latin text into a lowercase URL-safe base slug (3..40 chars).
 */
export function slugifyCompanyName(name: string): string {
  const lower = name.trim().toLowerCase();
  let transliterated = '';
  for (const ch of lower) {
    const mapped = CYRILLIC_TO_LATIN[ch];
    if (mapped !== undefined) {
      transliterated += mapped;
    } else {
      transliterated += ch;
    }
  }

  let slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (slug.length > SLUG_MAX_LENGTH) {
    slug = slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
  }

  if (slug.length < SLUG_MIN_LENGTH) {
    slug = slug.length === 0 ? 'company' : `${slug}-kg`.slice(0, SLUG_MAX_LENGTH);
  }

  if (slug.length < SLUG_MIN_LENGTH) {
    slug = slug.padEnd(SLUG_MIN_LENGTH, '0');
  }

  return slug;
}

/**
 * Generates a unique slug by checking collisions (including soft-deleted companies per §3.3 / BR-9)
 * and appending a numeric suffix (-2, -3, ...) when needed.
 */
export async function generateUniqueCompanySlug(
  companyName: string,
  slugExists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const baseSlug = slugifyCompanyName(companyName);

  if (!(await slugExists(baseSlug))) {
    return baseSlug;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const suffixPart = `-${suffix}`;
    const trimmedBase = baseSlug.slice(0, SLUG_MAX_LENGTH - suffixPart.length).replace(/-+$/g, '');
    const candidate = `${trimmedBase}${suffixPart}`;
    if (!(await slugExists(candidate))) {
      return candidate;
    }
    suffix += 1;
  }

  throw new Error('Unable to generate a unique company slug');
}
