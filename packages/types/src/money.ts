/** Pul API'da integer tiyin (1 so'm = 100 tiyin). Klientlarda yagona formatlash helperi. */
export const TIYIN_PER_SOM = 100;

export function formatMoney(tiyin: number, locale: 'uz' | 'ru' | 'en' = 'uz'): string {
  if (!Number.isSafeInteger(tiyin)) throw new TypeError('Money must be an integer amount in tiyin');
  const som = Math.trunc(tiyin / TIYIN_PER_SOM);
  const grouped = Math.abs(som).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const suffix = { uz: "so'm", ru: 'сум', en: 'UZS' }[locale];
  return `${som < 0 ? '-' : ''}${grouped} ${suffix}`;
}
