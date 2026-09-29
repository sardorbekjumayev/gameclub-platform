/** API vaqtlari UTC ISO-8601; ko'rsatish filial timezone'ida (default Asia/Tashkent). */
export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

const LOCALES = { uz: 'uz-Latn-UZ', ru: 'ru-RU', en: 'en-GB' } as const;

export function formatDateTime(iso: string, timeZone = DEFAULT_TIMEZONE, locale: keyof typeof LOCALES = 'uz'): string {
  return new Intl.DateTimeFormat(LOCALES[locale], {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}
