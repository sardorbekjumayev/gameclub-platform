"use client";

import { formatMoney } from "@gc/types";
import { useState } from "react";
import { BarChart, DateRange, rangeQuery, shortDate, todayLocal } from "@/components/analytics";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Card, Chip, Heading, Stat } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import type { GrowthPoint, PlatformOverview } from "@/lib/analytics-types";
import { useApi } from "@/lib/use-api";

export default function PlatformAnalyticsPage() {
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(() => todayLocal(-29));
  const [to, setTo] = useState(() => todayLocal());
  const [metric, setMetric] = useState<"gmv" | "bookings" | "new_users">("gmv");
  const q = rangeQuery(from, to);
  const o = useApi<PlatformOverview>(`/analytics/platform/overview?${q}`);
  const g = useApi<GrowthPoint[]>(`/analytics/platform/growth?${q}`);
  const m = (v: number) => formatMoney(v, locale);
  const d = o.data;

  return (
    <div className="space-y-5">
      <div>
        <Heading>{t("platformAnalytics.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("platformAnalytics.subtitle")}</p>
      </div>
      <DateRange
        from={from}
        to={to}
        onChange={(f, tt) => {
          setFrom(f);
          setTo(tt);
        }}
      />
      {!d ? (
        <LoadState loading={o.loading} error={o.error} onRetry={o.reload} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("analytics.kpi.gmv")} value={m(d.gmv)} />
            <Stat label={t("analytics.kpi.collected")} value={m(d.collected)} />
            <Stat label={t("analytics.kpi.commission")} value={m(d.commission)} accent />
            <Stat label={t("analytics.kpi.refunds")} value={m(d.refunds)} />
            <Stat label={t("analytics.kpi.bookings")} value={d.bookings_confirmed} />
            <Stat label={t("platformAnalytics.newCustomers")} value={d.new_customers} />
            <Stat label={t("platformAnalytics.activeBranches")} value={d.active_branches} />
            <Stat label={t("platformAnalytics.devices")} value={d.devices} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="space-y-2">
              <div className="font-display text-lg font-bold">{t("platformAnalytics.queues")}</div>
              {(["pending_clubs", "open_tickets", "reviews_to_moderate"] as const).map((k) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-muted">{t(`platformAnalytics.queue.${k}` as MessageKey)}</span>
                  <b className="tabular-nums">{d.queues[k]}</b>
                </div>
              ))}
            </Card>
            <Card className="space-y-2">
              <div className="font-display text-lg font-bold">{t("platformAnalytics.clubs")}</div>
              {Object.entries(d.clubs_by_status).map(([s, n]) => (
                <div key={s} className="flex items-center justify-between text-sm">
                  <StatusBadge status={s} />
                  <b className="tabular-nums">{n}</b>
                </div>
              ))}
            </Card>
            <Card className="space-y-2">
              <div className="font-display text-lg font-bold">{t("platformAnalytics.users")}</div>
              {Object.entries(d.users_by_type).map(([s, n]) => (
                <div key={s} className="flex justify-between text-sm">
                  <span className="text-muted">{t(`platformAnalytics.userType.${s}` as MessageKey)}</span>
                  <b className="tabular-nums">{n}</b>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-display text-lg font-bold">{t("platformAnalytics.growth")}</div>
          <div className="flex gap-2">
            {(["gmv", "bookings", "new_users"] as const).map((k) => (
              <Chip key={k} active={metric === k} onClick={() => setMetric(k)}>
                {t(`platformAnalytics.metric.${k}` as MessageKey)}
              </Chip>
            ))}
          </div>
        </div>
        {g.data ? <BarChart money={metric === "gmv"} points={g.data.map((p) => ({ label: shortDate(p.date), value: Number(p[metric]) }))} /> : <LoadState loading={g.loading} error={g.error} onRetry={g.reload} />}
      </Card>
      {d && (
        <Card className="space-y-3">
          <div className="font-display text-lg font-bold">{t("platformAnalytics.topClubs")}</div>
          {d.top_clubs.length === 0 ? (
            <Empty>{t("common.empty")}</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-2">{t("payout.club")}</th>
                  <th className="text-right">{t("analytics.kpi.collected")}</th>
                  <th className="text-right">{t("analytics.kpi.commission")}</th>
                </tr>
              </thead>
              <tbody>
                {d.top_clubs.map((c) => (
                  <tr key={c.club_id} className="border-t border-line-soft">
                    <td className="py-2">{c.name ?? "—"}</td>
                    <td className="text-right tabular-nums">{m(c.collected)}</td>
                    <td className="text-right tabular-nums">{m(c.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
