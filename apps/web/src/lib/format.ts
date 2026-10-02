/** Ko'rsatish: filial vaqti Asia/Tashkent (docs: API UTC, UI filial timezone). */
const TZ = "Asia/Tashkent";

export const fmtTime = (iso: string, tz = TZ) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

type T = (k: never, v?: Record<string, string | number>) => string;

/**
 * "Pa, 1-okt" — hafta kuni va oy nomi i18n kalitlaridan (`wd.0..6`, `mon.1..12`):
 * brauzerda `uz` locale ma'lumoti bo'lmasligi mumkin.
 */
export function fmtDate(iso: string, t: T, tz = TZ) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "numeric" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return t("date.short" as never, { wd: t(`wd.${wd}` as never), d: p.day, mon: t(`mon.${p.month}` as never) });
}

/** Toshkent bo'yicha bugungi sana (YYYY-MM-DD) + n kun. */
export function tzDate(offsetDays = 0, tz = TZ) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const fmtDistance = (m: number | null, locale: string) =>
  m == null ? null : m < 1000 ? `${Math.round(m)} ${locale === "ru" ? "м" : "m"}` : `${(m / 1000).toFixed(1)} ${locale === "ru" ? "км" : "km"}`;

export const durationLabel = (min: number, t: (k: never, v?: Record<string, string | number>) => string) =>
  min % 60 === 0 ? t("book.hoursN" as never, { n: min / 60 }) : min < 60 ? t("book.minN" as never, { n: min }) : t("book.hMin" as never, { h: Math.floor(min / 60), m: min % 60 });
