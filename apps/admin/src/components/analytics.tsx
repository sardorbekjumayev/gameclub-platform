"use client";

import { formatDateTime, formatMoney } from "@gc/types";
import { StatusBadge } from "@/components/status";
import { Button, Card, Field, Input, cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { API_URL } from "@/lib/api";
import type { Payout } from "@/lib/analytics-types";
import { session } from "@/lib/session";

/** Filial timezone (Asia/Tashkent, UTC+5, DST yo'q). */
const TZ = "Asia/Tashkent";

/** Bugungi sana `YYYY-MM-DD` ko'rinishida (Toshkent vaqti). */
export function todayLocal(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Toshkent sanasining boshlanishi → UTC ISO. */
export const dayStartIso = (date: string, plusDays = 0) => new Date(new Date(`${date}T00:00:00+05:00`).getTime() + plusDays * 86400_000).toISOString();

/** Sana oralig'i (ikkala kun ham kiritiladi) → API `from`/`to` (UTC ISO). */
export const rangeQuery = (from: string, to: string) => `from=${encodeURIComponent(dayStartIso(from))}&to=${encodeURIComponent(dayStartIso(to, 1))}`;

/** `YYYY-MM-DD` → `DD.MM` / `DD.MM.YYYY` (kalendar sana, timezone siljishisiz). */
export const shortDate = (d: string, year = false) => {
  const [y, m, day] = d.slice(0, 10).split("-");
  return year ? `${day}.${m}.${y}` : `${day}.${m}`;
};

export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label={t("analytics.from")}>
        <Input type="date" className="w-44" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} />
      </Field>
      <Field label={t("analytics.to")}>
        <Input type="date" className="w-44" value={to} min={from} onChange={(e) => e.target.value && onChange(from, e.target.value)} />
      </Field>
    </div>
  );
}

/** KPI karta: qiymat + oldingi davrga nisbatan o'zgarish. */
export function Kpi({ label, value, current, previous, accent }: { label: string; value: React.ReactNode; current?: number; previous?: number; accent?: boolean }) {
  const { t } = useI18n();
  let change: React.ReactNode = null;
  if (current !== undefined && previous !== undefined) {
    if (previous === 0) change = current === 0 ? null : <span className="text-accent">{t("analytics.new")}</span>;
    else {
      const d = (current - previous) / previous;
      change = <span className={d >= 0 ? "text-accent" : "text-danger-soft"}>{`${d >= 0 ? "▲" : "▼"} ${Math.abs(d * 100).toFixed(1)}%`}</span>;
    }
  }
  return (
    <div className="rounded-2xl bg-surface p-[18px]">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cx("mt-1.5 font-display text-2xl font-bold tabular-nums", accent && "text-accent")}>{value}</div>
      {change && (
        <div className="mt-1 text-xs font-semibold">
          {change} <span className="font-normal text-muted">{t("analytics.vsPrev")}</span>
        </div>
      )}
    </div>
  );
}

/** Oddiy ustunli diagramma (kutubxonasiz). `money` bo'lsa qiymatlar tiyin. */
export function BarChart({ points, money }: { points: { label: string; value: number }[]; money?: boolean }) {
  const { t, locale } = useI18n();
  const max = Math.max(0, ...points.map((p) => p.value));
  const fmt = (v: number) => (money ? formatMoney(v, locale) : String(v));
  if (points.length === 0 || max === 0) return <div className="py-10 text-center text-sm text-muted">{t("common.empty")}</div>;
  const step = Math.ceil(points.length / 12);
  return (
    <div>
      <div className="mb-2 text-xs text-muted tabular-nums">{t("analytics.max", { v: fmt(max) })}</div>
      <div className="flex h-48 items-end gap-[3px] border-b border-line-soft">
        {points.map((p) => (
          <div key={p.label} className="group relative flex h-full flex-1 items-end" title={`${p.label}: ${fmt(p.value)}`}>
            <div className="w-full rounded-t-[4px] bg-accent/80 transition group-hover:bg-accent" style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {points.map((p, i) => (
          <div key={p.label} className="flex-1 truncate text-center text-[10px] text-muted">
            {i % step === 0 ? p.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sahifalash tugmalari. */
export function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-sm text-muted">
      <span>{t("common.page", { page, pages })}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t("common.prev")}
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}

/** CSV faylni token bilan yuklab olish (oddiy link token yubormaydi). */
export async function downloadFile(path: string, filename: string) {
  const go = (token: string | null) => fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let res = await go(session.accessToken());
  if (res.status === 401) res = await go(await session.refresh());
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    throw Object.assign(new Error("download failed"), { code: json?.error?.code ?? "UNKNOWN" });
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Payout jadvali (klub va platforma sahifalari uchun umumiy). */
export function PayoutTable({ rows, showClub, actions }: { rows: Payout[]; showClub?: boolean; actions?: (p: Payout) => React.ReactNode }) {
  const { t, locale } = useI18n();
  const m = (v: number) => formatMoney(v, locale);
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            {showClub && <th className="px-4 py-3">{t("payout.club")}</th>}
            <th className="px-4 py-3">{t("payout.period")}</th>
            <th className="px-4 text-right">{t("payout.gross")}</th>
            <th className="px-4 text-right">{t("payout.commission")}</th>
            <th className="px-4 text-right">{t("payout.refunds")}</th>
            <th className="px-4 text-right">{t("payout.net")}</th>
            <th className="px-4">{t("payout.status")}</th>
            <th className="px-4">{t("payout.paidAt")}</th>
            {actions && <th className="px-4" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-line-soft align-top">
              {showClub && <td className="px-4 py-3 font-semibold">{p.club_name ?? "—"}</td>}
              <td className="whitespace-nowrap px-4 py-3">
                {formatDateTime(p.period_start)} — {formatDateTime(p.period_end)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{m(p.gross_amount)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{m(p.commission_amount)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{m(p.refunds_amount)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums">{m(p.net_amount)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={p.status} />
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {p.paid_at ? formatDateTime(p.paid_at) : "—"}
                {p.reference && <div className="font-mono">{p.reference}</div>}
              </td>
              {actions && <td className="px-4 py-3">{actions(p)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** 1–5 yulduzli reyting. */
export function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-warn" aria-label={`${rating}/5`}>
      {"★".repeat(rating)}
      <span className="text-muted/40">{"★".repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}
