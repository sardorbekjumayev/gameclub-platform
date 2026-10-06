"use client";

import { formatMoney } from "@gc/types";
import { ShieldCheck } from "lucide-react";
import { cx } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import type { CancellationPolicy } from "@/lib/types";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** 180 → "3 soat", 90 → "1 soat 30 daqiqa", 30 → "30 daqiqa". */
function span(min: number, t: T) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return t("policy.m", { n: m });
  return m ? t("policy.hm", { h, m }) : t("policy.h", { n: h });
}

/**
 * Siyosat qatorlari (eng uzoq muddatdan boshlab): "3 soatdan ko'p qolganda — 100% qaytariladi",
 * "1 soat – 3 soat qolganda — 70%", "1 soatdan kam qolganda — 20%", "Kelmasangiz — 10%".
 */
export function policyLines(policy: CancellationPolicy, t: T) {
  const rules = [...policy.rules].sort((a, b) => b.min_minutes_before_start - a.min_minutes_before_start);
  const refund = (p: number) => (p > 0 ? t("policy.refundPct", { p }) : t("policy.noRefund"));
  const lines = rules.map((r, i) => {
    const min = r.min_minutes_before_start;
    const upper = i > 0 ? rules[i - 1].min_minutes_before_start : null;
    const when =
      upper === null
        ? min > 0
          ? t("policy.moreThan", { time: span(min, t) })
          : t("policy.anytime")
        : min > 0
          ? t("policy.between", { from: span(min, t), to: span(upper, t) })
          : t("policy.lessThan", { time: span(upper, t) });
    return { when, value: refund(r.refund_percent), percent: r.refund_percent };
  });
  const noShow = policy.no_show_refund_percent ?? 0;
  lines.push({ when: t("policy.noShow"), value: refund(noShow), percent: noShow });
  return lines;
}

/** Bekor qilish/qaytarish shartlari — bron vidjetida va chiptada bir xil ko'rinadi. */
export function RefundPolicy({ policy, preview, paid, className }: { policy?: CancellationPolicy | null; preview?: { percent: number; amount: number } | null; paid?: number; className?: string }) {
  const { t, locale } = useI18n();
  if (!policy?.rules?.length) return null;
  return (
    <div className={cx("space-y-2 rounded-2xl border border-line-soft bg-surface-2 p-3.5", className)}>
      <div className="flex items-center gap-2 text-[13px] font-bold">
        <ShieldCheck className="h-4 w-4 text-accent" />
        {t("policy.title")}
      </div>
      <ul className="space-y-1 text-[13px]">
        {policyLines(policy, t).map((l) => (
          <li key={l.when} className="flex items-baseline justify-between gap-3">
            <span className="text-muted">{l.when}</span>
            <span className={cx("shrink-0 text-right font-semibold", l.percent >= 100 ? "text-accent" : l.percent === 0 ? "text-danger-soft" : "text-fg")}>{l.value}</span>
          </li>
        ))}
      </ul>
      {preview && (
        <div className="border-t border-line-soft pt-2 text-[13px] font-semibold">
          {paid && paid > 0 ? t("policy.now", { p: preview.percent, amount: formatMoney(preview.amount, locale) }) : t("policy.nowPct", { p: preview.percent })}
        </div>
      )}
    </div>
  );
}
