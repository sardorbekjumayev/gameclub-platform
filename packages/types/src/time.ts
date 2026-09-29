/** API vaqtlari UTC ISO-8601; ko'rsatish filial timezone'ida (default Asia/Tashkent). */
export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

type Locale = 'uz' | 'ru' | 'en';

/** `29.09.2026 21:41` — barcha tillarda bir xil raqamli format (ICU `uz` "M09" chiqaradi). */
export function formatDateTime(iso: string, timeZone = DEFAULT_TIMEZONE, _locale: Locale = 'uz'): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}
