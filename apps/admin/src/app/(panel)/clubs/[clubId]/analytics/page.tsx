"use client";

import { formatMoney } from "@gc/types";
import { useParams } from "next/navigation";
import { useState } from "react";
import { BarChart, DateRange, Kpi, Pager, PayoutTable, downloadFile, pct, rangeQuery, shortDate, todayLocal } from "@/components/analytics";
import { ClubHeader } from "@/components/club-tabs";
import { Empty, LoadState } from "@/components/status";
import { Alert, Button, Card, Chip, Select, Stat, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { useMyClub } from "@/lib/my-club";
import { useAuth } from "@/lib/session";
import type { Overview, Payout, RevenuePoint } from "@/lib/analytics-types";
import { useApi } from "@/lib/use-api";

type Group = "day" | "week" | "month";

export default function ClubAnalyticsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { can } = useAuth();
  const { branches } = useMyClub(clubId);
  const [from, setFrom] = useState(() => todayLocal(-29));
  const [to, setTo] = useState(() => todayLocal());
  const [branchId, setBranchId] = useState("");
  const [tab, setTab] = useState<"overview" | "payouts">("overview");
  const q = `club_id=${clubId}${branchId ? `&branch_id=${branchId}` : ""}&${rangeQuery(from, to)}`;

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      <div className="flex gap-2">
        <Chip active={tab === "overview"} onClick={() => setTab("overview")}>
          {t("analytics.tab.overview")}
        </Chip>
        <Chip active={tab === "payouts"} onClick={() => setTab("payouts")}>
          {t("analytics.tab.payouts")}
        </Chip>
      </div>
      {tab === "overview" ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <DateRange
                from={from}
                to={to}
                onChange={(f, tt) => {
                  setFrom(f);
                  setTo(tt);
                }}
              />
              {branches.length > 1 && (
                <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">{t("analytics.allBranches")}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            {can("reports.export") && <ExportButtons q={q} />}
          </div>
          <OverviewCards q={q} />
          <Revenue q={q} />
          <PeakHours q={q} />
          <div className="grid gap-5 xl:grid-cols-2">
            <PopularDevices q={q} />
            <BranchCompare q={`club_id=${clubId}&${rangeQuery(from, to)}`} />
          </div>
        </>
      ) : (
        <ClubPayouts clubId={clubId} />
      )}
    </div>
  );
}

function ExportButtons({ q }: { q: string }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [fmt, setFmt] = useState<"csv" | "xlsx">("xlsx");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-9 w-24 text-sm" value={fmt} onChange={(e) => setFmt(e.target.value as "csv" | "xlsx")} aria-label="format">
          <option value="xlsx">XLSX</option>
          <option value="csv">CSV</option>
        </Select>
        {(["bookings", "payments", "shifts"] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            variant="secondary"
            loading={busy === k}
            onClick={async () => {
              setBusy(k);
              setError(null);
              try {
                await downloadFile(`/reports/${k}?${q}&format=${fmt}`, `${k}-${todayLocal()}.${fmt}`);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(null);
              }
            }}
          >
            ⬇ {t(`analytics.export.${k}` as MessageKey)}
          </Button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

function OverviewCards({ q }: { q: string }) {
  const { t, locale } = useI18n();
  const o = useApi<Overview>(`/analytics/club/overview?${q}`);
  if (!o.data) return <LoadState loading={o.loading} error={o.error} onRetry={o.reload} />;
  const d = o.data;
  const m = (v: number) => formatMoney(v, locale);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label={t("analytics.kpi.gmv")} value={m(d.gmv)} current={d.gmv} previous={d.previous?.gmv} />
      <Kpi label={t("analytics.kpi.collected")} value={m(d.collected)} current={d.collected} previous={d.previous?.collected} />
      <Kpi label={t("analytics.kpi.net")} value={m(d.net)} current={d.net} previous={d.previous?.net} accent />
      <Kpi label={t("analytics.kpi.bookings")} value={d.bookings_confirmed} current={d.bookings_confirmed} previous={d.previous?.bookings_confirmed} />
      <Stat label={t("analytics.kpi.clubRevenue")} value={m(d.club_revenue)} />
      <Stat label={t("analytics.kpi.commission")} value={m(d.commission)} />
      <Stat label={t("analytics.kpi.refunds")} value={m(d.refunds)} />
      <Stat label={t("analytics.kpi.avgBooking")} value={m(d.avg_booking_value)} />
      <Stat label={t("analytics.kpi.occupancy")} value={pct(d.occupancy.rate)} />
      <Stat label={t("analytics.kpi.cancelRate")} value={pct(d.cancellation_rate)} />
      <Stat label={t("analytics.kpi.customers")} value={`${d.customers.unique} / ${d.customers.new}`} />
      <Stat label={t("analytics.kpi.repeatRate")} value={pct(d.customers.repeat_rate)} />
    </div>
  );
}

function Revenue({ q }: { q: string }) {
  const { t } = useI18n();
  const [group, setGroup] = useState<Group>("day");
  const [metric, setMetric] = useState<"collected" | "net" | "gmv" | "bookings">("collected");
  const r = useApi<RevenuePoint[]>(`/analytics/club/revenue?${q}&group=${group}`);
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-display text-lg font-bold">{t("analytics.revenue")}</div>
        <div className="flex flex-wrap gap-2">
          <Select className="h-9 text-sm" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
            {(["collected", "net", "gmv", "bookings"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`analytics.metric.${k}` as MessageKey)}
              </option>
            ))}
          </Select>
          {(["day", "week", "month"] as const).map((g) => (
            <Chip key={g} active={group === g} onClick={() => setGroup(g)}>
              {t(`analytics.group.${g}` as MessageKey)}
            </Chip>
          ))}
        </div>
      </div>
      {r.data ? (
        <BarChart money={metric !== "bookings"} points={r.data.map((p) => ({ label: group === "month" ? shortDate(p.date, true).slice(3) : shortDate(p.date), value: Number(p[metric]) }))} />
      ) : (
        <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      )}
    </Card>
  );
}

function PeakHours({ q }: { q: string }) {
  const { t } = useI18n();
  const r = useApi<{ dow: number; hour: number; value: number }[]>(`/analytics/club/peak-hours?${q}`);
  const max = Math.max(0, ...(r.data ?? []).map((c) => c.value));
  const cell = (dow: number, hour: number) => r.data?.find((c) => c.dow === dow && c.hour === hour)?.value ?? 0;
  return (
    <Card className="space-y-4">
      <div className="font-display text-lg font-bold">{t("analytics.peak")}</div>
      {!r.data ? (
        <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      ) : max === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-[3px] text-[10px] text-muted">
            <thead>
              <tr>
                <th />
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} className="w-6 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((dow) => (
                <tr key={dow}>
                  <td className="pr-2 text-xs font-semibold">{t(`analytics.dow.${dow}` as MessageKey)}</td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = cell(dow, h);
                    return <td key={h} title={`${v}`} className={cx("h-6 w-6 rounded-[4px]", v === 0 && "bg-surface-2")} style={v ? { background: "var(--color-accent)", opacity: 0.15 + (0.85 * v) / max } : undefined} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PopularDevices({ q }: { q: string }) {
  const { t, locale } = useI18n();
  const r = useApi<{ device: { id: string; name: string; type: string } | null; bookings: number; revenue: number }[]>(`/analytics/club/devices/popular?${q}`);
  return (
    <Card className="space-y-3">
      <div className="font-display text-lg font-bold">{t("analytics.devices")}</div>
      {!r.data ? (
        <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      ) : r.data.length === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-2">{t("analytics.col.device")}</th>
              <th className="text-right">{t("analytics.col.bookings")}</th>
              <th className="text-right">{t("analytics.col.revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {r.data.map((row, i) => (
              <tr key={row.device?.id ?? i} className="border-t border-line-soft">
                <td className="py-2">
                  {row.device?.name ?? "—"} <span className="text-xs text-muted">{row.device?.type}</span>
                </td>
                <td className="text-right tabular-nums">{row.bookings}</td>
                <td className="text-right tabular-nums">{formatMoney(Number(row.revenue), locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function BranchCompare({ q }: { q: string }) {
  const { t, locale } = useI18n();
  const r = useApi<{ branch: { id: string; name: string }; gmv: number; collected: number; net: number; bookings: number; occupancy: number; cancellation_rate: number }[]>(`/analytics/club/branches/compare?${q}`);
  return (
    <Card className="space-y-3">
      <div className="font-display text-lg font-bold">{t("analytics.branches")}</div>
      {!r.data ? (
        <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      ) : r.data.length === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2">{t("analytics.col.branch")}</th>
                <th className="text-right">{t("analytics.metric.collected")}</th>
                <th className="text-right">{t("analytics.metric.net")}</th>
                <th className="text-right">{t("analytics.col.bookings")}</th>
                <th className="text-right">{t("analytics.kpi.occupancy")}</th>
                <th className="text-right">{t("analytics.kpi.cancelRate")}</th>
              </tr>
            </thead>
            <tbody>
              {r.data.map((row) => (
                <tr key={row.branch.id} className="border-t border-line-soft">
                  <td className="py-2">{row.branch.name}</td>
                  <td className="text-right tabular-nums">{formatMoney(row.collected, locale)}</td>
                  <td className="text-right tabular-nums">{formatMoney(row.net, locale)}</td>
                  <td className="text-right tabular-nums">{row.bookings}</td>
                  <td className="text-right tabular-nums">{pct(row.occupancy)}</td>
                  <td className="text-right tabular-nums">{pct(row.cancellation_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ClubPayouts({ clubId }: { clubId: string }) {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const limit = 20;
  const r = useApi<Payout[]>(`/clubs/${clubId}/payouts?page=${page}&limit=${limit}`);
  const meta = r.meta as { total?: number; summary?: { pending: number; paid: number } } | null;
  return (
    <div className="space-y-4">
      {meta?.summary && (
        <div className="grid grid-cols-2 gap-3 md:max-w-xl">
          <Stat label={t("payout.pendingSum")} value={formatMoney(meta.summary.pending, locale)} />
          <Stat label={t("payout.paidSum")} value={formatMoney(meta.summary.paid, locale)} accent />
        </div>
      )}
      <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      {r.data?.length === 0 && <Empty>{t("payout.empty")}</Empty>}
      {!!r.data?.length && <PayoutTable rows={r.data} />}
      <Pager page={page} total={meta?.total ?? 0} limit={limit} onPage={setPage} />
    </div>
  );
}
