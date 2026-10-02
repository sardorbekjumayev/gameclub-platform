"use client";

import { formatMoney } from "@gc/types";
import { CalendarClock, Clock, Coins, LayoutGrid, Monitor, MonitorCheck, PlayCircle, Radio, Tags, Timer } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BranchPicker } from "@/components/club-tabs";
import { Empty, LoadState } from "@/components/status";
import { ActionTile, Badge, Card, Stat } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { useCurrentClub } from "@/lib/current-club";
import { useAuth } from "@/lib/session";
import type { LiveSnapshot } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Greeting } from "./greeting";

const BRANCH_KEY = "gc.live.branch";
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }).format(new Date(iso));

/** Operator / filial admini bosh sahifasi: smena holati, bugungi raqamlar, yaqin bronlar, katta "Live board" tugmasi. */
export function DeskDashboard() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const { club, loading, error, reload } = useCurrentClub();
  const branches = useMemo(() => club?.branches ?? [], [club]);
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(BRANCH_KEY);
    } catch {
      return null;
    }
  });
  const branchId = branches.find((b) => b.id === picked)?.id ?? branches[0]?.id ?? null;
  const live = useApi<LiveSnapshot>(branchId && can("sessions.view") ? `/branches/${branchId}/live` : null);
  const s = live.data?.stats;
  const base = club ? `/clubs/${club.id}` : "";

  if (!club) return <LoadState loading={loading} error={error} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <Greeting subtitle={live.data ? `${live.data.branch.club_name} · ${live.data.branch.name}` : t("dash.desk.subtitle")}>
        {live.data &&
          (live.data.open_shift ? (
            <Badge tone="green">
              {t("dash.desk.shiftOpen")} · {time(live.data.open_shift.opened_at)}
            </Badge>
          ) : (
            <Badge tone="amber">{t("dash.desk.shiftClosed")}</Badge>
          ))}
      </Greeting>

      {branches.length > 1 && (
        <BranchPicker
          branches={branches}
          value={branchId}
          onChange={(id) => {
            setPicked(id);
            try {
              localStorage.setItem(BRANCH_KEY, id);
            } catch {
              /* storage yo'q */
            }
          }}
        />
      )}

      <Link href="/live" className="group relative block overflow-hidden rounded-3xl bg-accent p-6 text-on-accent sm:p-8">
        <div aria-hidden className="absolute -right-10 -bottom-16 h-56 w-56 rounded-full bg-white/20 blur-2xl" />
        <div className="relative flex items-center gap-5">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-on-accent text-accent">
            <Radio className="h-7 w-7" />
          </span>
          <div className="flex-1">
            <div className="font-display text-2xl font-bold">{t("dash.desk.openLive")}</div>
            <div className="text-sm font-semibold opacity-75">{t("dash.desk.openLiveHint")}</div>
          </div>
          <PlayCircle className="hidden h-10 w-10 transition group-hover:scale-110 sm:block" />
        </div>
      </Link>

      {can("sessions.view") && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">{t("dash.today")}</h2>
          {!s ? (
            <LoadState loading={live.loading} error={live.error} onRetry={live.reload} />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon={Coins} label={t("dash.desk.revenue")} value={formatMoney(s.today_revenue, locale)} accent />
              <Stat icon={Timer} label={t("dash.activeSessions")} value={s.active_sessions} />
              <Stat icon={MonitorCheck} label={t("dash.desk.free")} value={`${s.free_devices} / ${s.total_devices}`} />
              <Stat icon={CalendarClock} label={t("dash.desk.upcoming")} value={s.upcoming_bookings} />
            </div>
          )}
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="space-y-3 border border-line-soft lg:col-span-2">
          <div className="font-display text-lg font-bold">{t("dash.desk.nextBookings")}</div>
          {live.data && live.data.upcoming.length === 0 && <Empty>{t("dash.desk.noBookings")}</Empty>}
          {live.data?.upcoming.slice(0, 6).map((b) => {
            const dev = live.data!.devices.find((d) => d.id === b.device_id);
            return (
              <div key={b.booking_id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-3 text-sm">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-3 text-accent">
                  <Clock className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{b.customer_name ?? "—"}</div>
                  <div className="text-xs text-muted">
                    {dev?.name ?? "—"} · #{b.code}
                  </div>
                </div>
                <b className="tabular-nums">
                  {time(b.start_at)}–{time(b.end_at)}
                </b>
              </div>
            );
          })}
        </Card>
        <div className="space-y-3">
          {[
            { href: `${base}/devices`, icon: Monitor, title: t("club.tab.devices"), desc: t("dash.club.devices"), perm: "devices.view" },
            { href: `${base}/layout`, icon: LayoutGrid, title: t("club.tab.layout"), desc: t("dash.club.layout"), perm: "devices.view" },
            { href: `${base}/tariffs`, icon: Tags, title: t("club.tab.tariffs"), desc: t("dash.club.tariffs"), perm: "tariffs.view" },
          ]
            .filter((a) => can(a.perm))
            .map((a) => (
              <Link key={a.href} href={a.href} className="block">
                <ActionTile icon={a.icon} title={a.title} desc={a.desc} />
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
