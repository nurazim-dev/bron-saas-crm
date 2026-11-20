'use client';
import { Button } from '@/components/ui/button';
import { PUBLIC_DICT, type PublicLang } from '@/lib/i18n/public-dict';
export function CalendarButton({
  startAt,
  endAt,
  title,
  address,
  lang,
}: {
  startAt: string;
  endAt: string;
  title: string;
  address?: string | null;
  lang: PublicLang;
}) {
  function download() {
    const escape = (value: string) =>
      value
        .replace(/\\/g, '\\\\')
        .replace(/\r?\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
    const stamp = (value: string) =>
      new Date(value)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Zapis.kg//Booking//RU',
      'BEGIN:VEVENT',
      `UID:${crypto.randomUUID()}@zapis.kg`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(startAt)}`,
      `DTEND:${stamp(endAt)}`,
      `SUMMARY:${escape(title)}`,
      `LOCATION:${escape(address ?? '')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    // Fold at UTF-8 byte boundaries (RFC 5545), preserving Cyrillic characters.
    const encoder = new TextEncoder();
    const content =
      lines
        .map((line) => {
          let result = '',
            width = 0;
          for (const char of line) {
            const size = encoder.encode(char).length;
            if (width + size > 73) {
              result += '\r\n ';
              width = 1;
            }
            result += char;
            width += size;
          }
          return result;
        })
        .join('\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'zapis-appointment.ics';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Button variant="outline" className="w-full" onClick={download}>
      {PUBLIC_DICT[lang].calendar}
    </Button>
  );
}
