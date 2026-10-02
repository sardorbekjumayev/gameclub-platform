"use client";

import { CalendarDays, Heart, Home, LogIn, Map, Search, UserCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-bell";
import { Logo, cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

export function Header() {
  const { t } = useI18n();
  const { me, loading } = useAuth();
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const links = [
    { href: "/clubs", label: t("nav.clubs"), icon: Search, show: true },
    { href: "/map", label: t("nav.map"), icon: Map, show: true },
    { href: "/bookings", label: t("nav.bookings"), icon: CalendarDays, show: !!me },
    { href: "/favorites", label: t("nav.favorites"), icon: Heart, show: !!me },
  ].filter((l) => l.show);

  const tabs = [
    { href: "/", label: t("nav.home"), icon: Home },
    { href: "/clubs", label: t("nav.clubs"), icon: Search },
    { href: "/map", label: t("nav.map"), icon: Map },
    ...(me
      ? [
          { href: "/bookings", label: t("nav.bookings"), icon: CalendarDays },
          { href: "/profile", label: t("nav.profile"), icon: UserCircle },
        ]
      : [{ href: "/login", label: t("nav.login"), icon: LogIn }]),
  ];

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line-soft bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/" aria-label={t("app.title")}>
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={cx(
                  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] font-semibold transition",
                  active(l.href) ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface hover:text-fg",
                )}
              >
                <l.icon className={cx("h-4 w-4", active(l.href) && "text-accent")} />
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <LocaleSwitcher />
            {me && <NotificationBell />}
            {!loading &&
              (me ? (
                <Link
                  href="/profile"
                  className="hidden items-center gap-2 rounded-full border border-line py-1 pr-3.5 pl-1 text-sm font-semibold transition hover:border-accent/50 sm:inline-flex"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-accent font-bold text-on-accent">{(me.first_name || "?").slice(0, 1).toUpperCase()}</span>
                  {me.first_name || t("nav.profile")}
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent transition hover:bg-accent-hover sm:h-11 sm:px-5"
                >
                  <LogIn className="h-4 w-4" />
                  {t("nav.login")}
                </Link>
              ))}
          </div>
        </div>
      </header>

      {/* Mobil pastki navigatsiya */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line-soft bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold", active(tab.href) ? "text-accent" : "text-muted")}
            >
              <tab.icon className="h-5 w-5" />
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
