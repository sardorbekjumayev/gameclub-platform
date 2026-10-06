import type { MessageKey } from "@/i18n/provider";
import type { CancellationPolicy } from "./types";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Daqiqani o'qiladigan ko'rinishga: 90 → "1 soat 30 daqiqa". */
export function fmtDuration(min: number, t: T) {
  if (min < 60) return t("dur.min", { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t("dur.hourMin", { h, m }) : t("dur.hour", { n: h });
}

/** Siyosat qatorlari (mijoz to'lov paytida ko'radigan matn bilan bir xil). */
export function policyLines(p: CancellationPolicy, t: T) {
  const rules = [...p.rules].sort((a, b) => b.min_minutes_before_start - a.min_minutes_before_start);
  const refund = (pct: number) => (pct > 0 ? t("policy.refund", { p: pct }) : t("policy.noRefund"));
  const lines = rules.map((r, i) => {
    const prev = rules[i - 1];
    let when: string;
    if (rules.length === 1 && r.min_minutes_before_start === 0) when = t("policy.any");
    else if (i === 0) when = t("policy.from", { d: fmtDuration(r.min_minutes_before_start, t) });
    else if (r.min_minutes_before_start === 0) when = t("policy.less", { d: fmtDuration(prev.min_minutes_before_start, t) });
    else when = t("policy.between", { from: fmtDuration(r.min_minutes_before_start, t), to: fmtDuration(prev.min_minutes_before_start, t) });
    return { when, what: refund(r.refund_percent), percent: r.refund_percent };
  });
  lines.push({ when: t("policy.noShow"), what: refund(p.no_show_refund_percent ?? 0), percent: p.no_show_refund_percent ?? 0 });
  return lines;
}

/** Kartani 4 tadan guruhlash va turini aniqlash (UzCard/Humo/Visa/Mastercard). */
export const fmtCard = (n: string) => n.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");

export function cardBrand(n: string) {
  const d = n.replace(/\D/g, "");
  if (d.startsWith("8600") || d.startsWith("5614")) return "UzCard";
  if (d.startsWith("9860")) return "Humo";
  if (d.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return "Mastercard";
  return null;
}
