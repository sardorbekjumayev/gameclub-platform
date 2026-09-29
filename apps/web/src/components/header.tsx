"use client";

import Link from "next/link";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

export function Header() {
  const { t } = useI18n();
  const { me, loading } = useAuth();
  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold">
          <span className="text-violet-600">●</span> {t("app.title")}
        </Link>
        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          {!loading &&
            (me ? (
              <Link href="/profile" className="text-sm font-medium hover:text-violet-600">
                {me.first_name || t("nav.profile")}
              </Link>
            ) : (
              <Link href="/login" className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500">
                {t("nav.login")}
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}
