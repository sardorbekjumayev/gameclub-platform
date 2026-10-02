/** Filial vaqti Asia/Tashkent (UTC+05:00, DST yo'q) — ko'rsatish uchun. */
const TZ = "Asia/Tashkent";

export const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** Soniyalar → 01:23:45 (manfiy — overtime, "-00:05:12"). */
export function fmtClock(sec: number) {
  const sign = sec < 0 ? "-" : "";
  const a = Math.abs(sec);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${sign}${p(Math.floor(a / 3600))}:${p(Math.floor((a % 3600) / 60))}:${p(a % 60)}`;
}
