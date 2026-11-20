/**
 * Escapes a single CSV cell against Excel/Sheets formula injection and quotes special chars.
 */
export function escapeCsvCell(raw: string | number | null | undefined): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
