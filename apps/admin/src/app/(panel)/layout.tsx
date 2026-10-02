"use client";

import {
  BarChart3,
  Building,
  ClipboardCheck,
  Layers,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  MessageSquareWarning,
  Radio,
  UserCircle,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CLUB_TABS } from "@/components/club-tabs";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { WrongPanel } from "@/components/wrong-panel";
import { Alert, Button, Logo, Spinner, cx } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { useCurrentClub } from "@/lib/current-club";
import { PANEL, canUsePanel, isPathAllowed } from "@/lib/panel";
import { useAuth } from "@/lib/session";

type NavItem = { href: string; label: MessageKey; icon: LucideIcon; permission?: string; section?: MessageKey; exact?: boolean };

const PLATFORM_NAV: NavItem[] = [
  { href: "/", label: "nav.dashboard", icon: LayoutDashboard, exact: true },
  { href: "/platform/clubs", label: "nav.clubApprovals", icon: ClipboardCheck, permission: "platform.clubs.approve", section: "nav.section.platform" },
  { href: "/platform/analytics", label: "nav.platformAnalytics", icon: BarChart3, permission: "platform.analytics.view", section: "nav.section.platform" },
  { href: "/platform/plans", label: "nav.plans", icon: Layers, permission: "platform.subscriptions.manage", section: "nav.section.platform" },
  { href: "/platform/users", label: "nav.users", icon: Users, permission: "platform.users.view", section: "nav.section.platform" },
  { href: "/platform/reviews", label: "nav.reviewModeration", icon: MessageSquareWarning, permission: "platform.reviews.moderate", section: "nav.section.platform" },
  { href: "/platform/payouts", label: "nav.payouts", icon: Wallet, permission: "platform.payouts.manage", section: "nav.section.platform" },
];

/** Klub/filial bo'limlari — joriy klub id si bilan. Desk panelda klub profili va filiallar yo'q. */
function clubNav(clubId: string | null): NavItem[] {
  if (!clubId) return [];
  const section: MessageKey = PANEL === "desk" ? "nav.section.branch" : "nav.section.club";
  return CLUB_TABS.filter((tab) => PANEL !== "desk" || (tab.seg !== "" && tab.seg !== "/branches")).map((tab) => ({
    href: `/clubs/${clubId}${tab.seg}`,
    label: tab.label,
    icon: tab.icon,
    permission: tab.permission,
    section,
    exact: tab.seg === "",
  }));
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, signOut, can } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const allowed = !!me && canUsePanel(me, PANEL);
  const current = useCurrentClub();

  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [loading, me, router]);

  useEffect(() => {
    if (allowed && !isPathAllowed(pathname)) router.replace("/");
  }, [allowed, pathname, router]);

  if (loading || !me) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Klubi yo'q mijoz — klub panelida faqat klub ochish wizard'i
  const isCustomerOnly = me.roles.every((r) => r.role === "CUSTOMER");
  if (isCustomerOnly && PANEL === "club") {
    if (pathname === "/clubs/new") return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>;
    return (
      <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 px-4">
        <Alert tone="info">{t("auth.noAccess")}</Alert>
        <Button onClick={() => router.push("/clubs/new")}>{t("onboarding.cta")}</Button>
        <Button variant="secondary" onClick={signOut}>
          {t("auth.logout")}
        </Button>
      </main>
    );
  }
  if (!allowed) return <WrongPanel />;

  const nav: NavItem[] =
    PANEL === "platform"
      ? PLATFORM_NAV
      : [
          { href: "/", label: "nav.dashboard", icon: LayoutDashboard, exact: true },
          { href: "/live", label: "nav.live", icon: Radio, permission: "sessions.view" },
          ...clubNav(current.club?.id ?? null),
          ...(PANEL === "club" ? [{ href: "/clubs", label: "nav.clubs" as MessageKey, icon: Building, exact: true, section: "nav.section.account" as MessageKey }] : []),
        ];
  const items = [...nav.filter((i) => !i.permission || can(i.permission)), { href: "/profile", label: "nav.profile" as MessageKey, icon: UserCircle, section: "nav.section.account" as MessageKey }];
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email || me.phone;
  const isActive = (i: NavItem) => (i.exact ? pathname === i.href : pathname === i.href || pathname.startsWith(`${i.href}/`));

  return (
    <div className="flex min-h-screen flex-1">
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-line-soft bg-bg px-3 py-5 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-3 pb-2">
          <Logo className="text-xl" />
          <button className="text-muted hover:text-fg md:hidden" onClick={() => setOpen(false)} aria-label={t("common.close")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-3 mb-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-accent">
          {t(`panel.${PANEL}` as MessageKey)}
        </div>
        {PANEL !== "platform" && current.clubs.length > 1 && (
          <select
            value={current.club?.id ?? ""}
            onChange={(e) => current.select(e.target.value)}
            className="mx-2 mb-3 h-10 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-fg outline-none"
            aria-label={t("nav.clubs")}
          >
            {current.clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {items.map((i, idx) => (
            <div key={i.href}>
              {i.section && items[idx - 1]?.section !== i.section && (
                <div className="mt-5 mb-1.5 px-3 text-[11px] font-bold uppercase tracking-widest text-muted/70">{t(i.section)}</div>
              )}
              <Link
                href={i.href}
                onClick={() => setOpen(false)}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition",
                  isActive(i) ? "bg-accent/10 font-bold text-accent" : "font-semibold text-muted hover:bg-surface hover:text-fg",
                )}
              >
                <i.icon className="h-[18px] w-[18px] shrink-0" />
                {t(i.label)}
              </Link>
            </div>
          ))}
        </nav>
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-line-soft bg-surface px-3 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-3 font-bold text-accent">{(name ?? "?").slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{name}</div>
            <div className="truncate text-xs text-muted">{[...new Set(me.roles.map((r) => t(`role.${r.role}` as MessageKey)))].join(", ")}</div>
          </div>
          <button
            className="text-muted transition hover:text-danger-soft"
            title={t("auth.logout")}
            aria-label={t("auth.logout")}
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-line-soft bg-bg/85 px-4 backdrop-blur md:px-8">
          <button className="rounded-lg p-2 text-muted hover:text-fg md:hidden" onClick={() => setOpen(true)} aria-label={t("common.menu")}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-7">{children}</main>
      </div>
    </div>
  );
}
