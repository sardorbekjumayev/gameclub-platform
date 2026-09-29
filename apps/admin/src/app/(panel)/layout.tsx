"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Alert, Button, Spinner } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

type NavItem = { href: string; label: MessageKey; permission?: string; section?: MessageKey };

const NAV: NavItem[] = [
  { href: "/", label: "nav.dashboard" },
  { href: "/platform/users", label: "nav.users", permission: "platform.users.view", section: "nav.section.platform" },
  { href: "/profile", label: "nav.profile" },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, signOut, can } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [loading, me, router]);

  if (loading || !me) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        <Spinner />
      </div>
    );
  }

  if (me.type === "CUSTOMER") {
    return (
      <main className="mx-auto flex max-w-md flex-1 flex-col justify-center gap-4 px-4">
        <Alert>{t("auth.noAccess")}</Alert>
        <Button variant="secondary" onClick={signOut}>
          {t("auth.logout")}
        </Button>
      </main>
    );
  }

  const items = NAV.filter((i) => !i.permission || can(i.permission));
  const name = [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email || me.phone;

  return (
    <div className="flex min-h-screen flex-1">
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-60 border-r border-zinc-200 bg-white p-4 transition-transform dark:border-zinc-800 dark:bg-zinc-900 md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-6 px-2 text-lg font-semibold">
          <span className="text-violet-600">●</span> Game Club
        </div>
        <nav className="space-y-1">
          {items.map((i, idx) => (
            <div key={i.href}>
              {i.section && items[idx - 1]?.section !== i.section && (
                <div className="mt-4 mb-1 px-2 text-xs font-medium uppercase tracking-wide text-zinc-400">{t(i.section)}</div>
              )}
              <Link
                href={i.href}
                onClick={() => setOpen(false)}
                className={`block rounded-lg px-3 py-2 text-sm ${pathname === i.href ? "bg-violet-50 font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                {t(i.label)}
              </Link>
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
          <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher />
            <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">{name}</span>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              {t("auth.logout")}
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
