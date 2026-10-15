"use client";

import { formatDateTime, formatMoney } from "@gc/types";
import { FileText } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status";
import { Card, cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { ClubSubscription } from "@/lib/types";

/** Klubning joriy rejasi va limitlardan foydalanish (egasi va super admin sahifalarida). */
export function SubscriptionCard({ data, children }: { data: ClubSubscription; children?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const sub = data.subscription;
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-muted">{t("plan.current")}</div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xl font-bold">{sub ? sub.plan.name : t("plan.none")}</span>
            {sub && <StatusBadge status={sub.status} />}
          </div>
          {sub && (
            <div className="text-xs text-muted">
              {t("plan.periodEnds", { date: formatDateTime(sub.current_period_end, undefined, locale) })} · {formatMoney(sub.plan.price_per_month, locale)}/{t("plan.month")}
            </div>
          )}
        </div>
        <Link href="/partner-terms" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-accent">
          <FileText className="h-3.5 w-3.5" />
          {t("legal.partnerLink")}
        </Link>
      </div>
      {!sub &&<div className="text-sm text-danger-soft">{t("plan.noneHint")}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        {(["branches", "devices", "staff"] as const).map((k) => {
          const limit = sub?.plan.limits[k] ?? null;
          const used = data.usage[k];
          const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          return (
            <div key={k} className="rounded-xl bg-surface-2 p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t(`plan.limit.${k}` as never)}</span>
                <span className="font-bold tabular-nums">
                  {used} / {limit === null ? "∞" : limit}
                </span>
              </div>
              {limit !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className={cx("h-full rounded-full", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warn" : "bg-accent")} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {children}
    </Card>
  );
}
