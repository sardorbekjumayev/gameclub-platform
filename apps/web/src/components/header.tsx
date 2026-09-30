"use client";

import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

export function Header() {
  const { t } = useI18n();
  const { me, loading } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-line-soft bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-8">
        <Link href="/" aria-label={t("app.title")}>
          <Logo />
        </Link>
        <div className="flex items-center gap-2 sm:gap-5">
          <Link href="/map" className="hidden text-[15px] sm:inline font-semibold text-muted transition hover:text-fg">
            {t("nav.map")}
          </Link>
          <LocaleSwitcher />
          {!loading &&
            (me ? (
              <Link href="/profile" className="text-[15px] font-semibold text-muted transition hover:text-fg">
                {me.first_name || t("nav.profile")}
              </Link>
            ) : (
              <Link href="/login" className="inline-flex h-10 items-center rounded-xl bg-accent px-4 sm:h-11 sm:px-5 text-sm font-bold text-on-accent transition hover:bg-accent-hover">
                {t("nav.login")}
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}
