"use client";

import { formatMoney } from "@gc/types";
import { Activity, BarChart3, CalendarCheck, Coins, Gauge, LayoutGrid, MapPin, Monitor, PlusCircle, Radio, Rocket, Tags, Users } from "lucide-react";
import Link from "next/link";
import { BarChart, rangeQuery, shortDate, todayLocal } from "@/components/analytics";
import { LoadState, StatusBadge } from "@/components/status";
import { ActionTile, Alert, Button, Card, Stat } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { Overview, RevenuePoint } from "@/lib/analytics-types";
import { useCurrentClub } from "@/lib/current-club";
import { isPlatformStaff } from "@/lib/panel";
import { useAuth } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { Greeting } from "./greeting";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Klub egasi / admini bosh sahifasi: bugungi ko'rsatkichlar, 14 kunlik tushum, tezkor amallar. */
export function ClubDashboard() {
  const { t, locale } = useI18n();
  const { can, me } = useAuth();
  const { club, clubs, loading, error, reload } = useCurrentClub();
  const reports = !!club && club.status === "ACTIVE" && can("reports.view");
  const today = useApi<Overview>(reports ? `/analytics/club/overview?club_id=${club.id}&${rangeQuery(todayLocal(), todayLocal())}` : null);
  const trend = useApi<RevenuePoint[]>(reports ? `/analytics/club/revenue?club_id=${club.id}&${rangeQuery(todayLocal(-13), todayLocal())}&group=day` : null);
  const m = (v: number) => formatMoney(v, locale);

  if (!club) {
    if (loading || error) return <LoadState loading={loading} error={error} onRetry={reload} />;
    return (
      <div className="mx-auto max-w-xl space-y-5 py-10 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-accent text-on-accent">
          <Rocket className="h-8 w-8" />
        </span>
        <h1 className="font-display text-3xl font-bold">{t("dash.club.emptyTitle")}</h1>
        <p className="text-muted">{t("dash.club.emptyText")}</p>
        {!isPlatformStaff(me) && (
          <Link href="/clubs/new">
            <Button size="lg">
              <PlusCircle className="h-5 w-5" />
              {t("onboarding.cta")}
            </Button>
          </Link>
        )}
      </div>
    );
  }

  const base = `/clubs/${club.id}`;
  const d = today.data;
  const actions = [
    { href: "/live", icon: Radio, title: t("nav.live"), desc: t("dash.club.live"), perm: "sessions.view", accent: true },
    { href: `${base}/devices`, icon: Monitor, title: t("club.tab.devices"), desc: t("dash.club.devices"), perm: "devices.view" },
    { href: `${base}/layout`, icon: LayoutGrid, title: t("club.tab.layout"), desc: t("dash.club.layout"), perm: "devices.view" },
    { href: `${base}/tariffs`, icon: Tags, title: t("club.tab.tariffs"), desc: t("dash.club.tariffs"), perm: "tariffs.view" },
    { href: `${base}/staff`, icon: Users, title: t("club.tab.staff"), desc: t("dash.club.staff"), perm: "staff.view" },
    { href: `${base}/analytics`, icon: BarChart3, title: t("club.tab.analytics"), desc: t("dash.club.analytics"), perm: "reports.view" },
  ].filter((a) => can(a.perm));

  return (
    <div className="space-y-6">
      <Greeting subtitle={clubs.length > 1 ? club.name : t("dash.club.subtitle")}>
        <StatusBadge status={club.status} />
      </Greeting>

      {club.status === "PENDING_APPROVAL" || club.status === "DRAFT" ? <Alert tone="info">{t("dash.club.pending")}</Alert> : null}
      {club.status === "REJECTED" && club.rejection_reason && <Alert>{club.rejection_reason}</Alert>}
      {club.status === "SUSPENDED" && club.suspended_reason && <Alert>{club.suspended_reason}</Alert>}

      {reports && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">{t("dash.today")}</h2>
          {!d ? (
            <LoadState loading={today.loading} error={today.error} onRetry={today.reload} />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon={Coins} label={t("analytics.kpi.collected")} value={m(d.collected)} accent />
              <Stat icon={CalendarCheck} label={t("analytics.kpi.bookings")} value={d.bookings_confirmed} />
              <Stat icon={Gauge} label={t("analytics.kpi.occupancy")} value={pct(d.occupancy.rate)} />
              <Stat icon={Activity} label={t("dash.activeSessions")} value={d.active_sessions} />
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">{t("dash.quick")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {actions.map((a) => (
            <Link key={a.href} href={a.href}>
              <ActionTile icon={a.icon} title={a.title} desc={a.desc} tone={a.accent ? "accent" : "default"} />
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {reports && (
          <Card className="space-y-3 border border-line-soft lg:col-span-2">
            <div className="flex items-center justify-between">
              <div className="font-display text-lg font-bold">{t("dash.club.trend")}</div>
              <Link href={`${base}/analytics`} className="text-sm font-bold text-accent">
                {t("dash.more")} →
              </Link>
            </div>
            {trend.data ? (
              <BarChart money points={trend.data.map((p) => ({ label: shortDate(p.date), value: Number(p.collected) }))} />
            ) : (
              <LoadState loading={trend.loading} error={trend.error} onRetry={trend.reload} />
            )}
          </Card>
        )}
        <Card className={`space-y-3 border border-line-soft ${reports ? "" : "lg:col-span-3"}`}>
          <div className="flex items-center justify-between">
            <div className="font-display text-lg font-bold">{t("club.tab.branches")}</div>
            {can("branches.view") && (
              <Link href={`${base}/branches`} className="text-sm font-bold text-accent">
                {t("dash.manage")} →
              </Link>
            )}
          </div>
          {club.branches.length === 0 ? (
            <div className="text-sm text-muted">{t("dash.club.noBranches")}</div>
          ) : (
            club.branches.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
                <MapPin className="h-4 w-4 text-accent" />
                <span className="flex-1 truncate text-sm font-semibold">{b.name}</span>
                <StatusBadge status={b.status} />
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
