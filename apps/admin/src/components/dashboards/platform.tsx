"use client";

import { formatMoney } from "@gc/types";
import { BarChart3, Building2, CalendarCheck, ClipboardCheck, Coins, Layers, MessageSquareWarning, Percent, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { rangeQuery, todayLocal } from "@/components/analytics";
import { LoadState } from "@/components/status";
import { ActionTile, Card, Stat } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { PlatformOverview } from "@/lib/analytics-types";
import { useAuth } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { Greeting } from "./greeting";

/** Platforma paneli bosh sahifasi: navbatlar (arizalar, sharhlar) + 30 kunlik ko'rsatkichlar. */
export function PlatformDashboard() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const q = rangeQuery(todayLocal(-29), todayLocal());
  const o = useApi<PlatformOverview>(can("platform.analytics.view") ? `/analytics/platform/overview?${q}` : null);
  const d = o.data;
  const m = (v: number) => formatMoney(v, locale);

  const queues = [
    { href: "/platform/clubs", icon: ClipboardCheck, label: t("platformAnalytics.queue.pending_clubs"), value: d?.queues.pending_clubs, perm: "platform.clubs.approve" },
    { href: "/platform/reviews", icon: MessageSquareWarning, label: t("platformAnalytics.queue.reviews_to_moderate"), value: d?.queues.reviews_to_moderate, perm: "platform.reviews.moderate" },
  ].filter((x) => can(x.perm));

  return (
    <div className="space-y-6">
      <Greeting subtitle={t("dash.platform.subtitle")} />

      {queues.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {queues.map((x) => (
            <Link key={x.href} href={x.href} className="group flex items-center gap-4 rounded-2xl border border-line-soft bg-surface p-5 transition hover:border-accent/50">
              <span className={`grid h-12 w-12 place-items-center rounded-xl ${x.value ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted"}`}>
                <x.icon className="h-6 w-6" />
              </span>
              <div className="flex-1">
                <div className="text-sm text-muted">{x.label}</div>
                <div className="font-display text-3xl font-bold tabular-nums">{x.value ?? "—"}</div>
              </div>
              <span className="text-sm font-bold text-accent opacity-0 transition group-hover:opacity-100">{t("dash.open")} →</span>
            </Link>
          ))}
        </div>
      )}

      {can("platform.analytics.view") && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">{t("dash.last30")}</h2>
          {!d ? (
            <LoadState loading={o.loading} error={o.error} onRetry={o.reload} />
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat icon={Coins} label={t("analytics.kpi.gmv")} value={m(d.gmv)} />
              <Stat icon={Percent} label={t("analytics.kpi.commission")} value={m(d.commission)} accent />
              <Stat icon={CalendarCheck} label={t("analytics.kpi.bookings")} value={d.bookings_confirmed} />
              <Stat icon={Users} label={t("platformAnalytics.newCustomers")} value={d.new_customers} />
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">{t("dash.quick")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            { href: "/platform/clubs", icon: Building2, title: t("nav.clubApprovals"), desc: t("dash.platform.clubs"), perm: "platform.clubs.approve" },
            { href: "/platform/analytics", icon: BarChart3, title: t("nav.platformAnalytics"), desc: t("dash.platform.analytics"), perm: "platform.analytics.view" },
            { href: "/platform/plans", icon: Layers, title: t("nav.plans"), desc: t("dash.platform.plans"), perm: "platform.subscriptions.manage" },
            { href: "/platform/users", icon: Users, title: t("nav.users"), desc: t("dash.platform.users"), perm: "platform.users.view" },
            { href: "/platform/payouts", icon: Wallet, title: t("nav.payouts"), desc: t("dash.platform.payouts"), perm: "platform.payouts.manage" },
          ]
            .filter((a) => can(a.perm))
            .map((a) => (
              <Link key={a.href} href={a.href}>
                <ActionTile icon={a.icon} title={a.title} desc={a.desc} />
              </Link>
            ))}
        </div>
      </section>

      {d && d.top_clubs.length > 0 && (
        <Card className="space-y-3 border border-line-soft">
          <div className="font-display text-lg font-bold">{t("platformAnalytics.topClubs")}</div>
          {d.top_clubs.slice(0, 5).map((c, i) => (
            <div key={c.club_id} className="flex items-center gap-3 text-sm">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-surface-2 font-bold text-muted">{i + 1}</span>
              <span className="flex-1 font-semibold">{c.name ?? "—"}</span>
              <b className="tabular-nums">{m(c.collected)}</b>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
