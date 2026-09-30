"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Alert, Button, Logo, Spinner } from "@/components/ui";
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
      <div className="flex flex-1 items-center justify-center">
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
        className={`fixed inset-y-0 left-0 z-30 w-[220px] border-r border-line-soft bg-bg px-4 py-6 transition-transform md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="px-3 pb-4">
          <Logo className="text-xl" />
        </div>
        <nav className="space-y-1.5">
          {items.map((i, idx) => (
            <div key={i.href}>
              {i.section && items[idx - 1]?.section !== i.section && (
                <div className="mt-5 mb-1 px-3 text-[11px] font-bold uppercase tracking-widest text-muted/70">{t(i.section)}</div>
              )}
              <Link
                href={i.href}
                onClick={() => setOpen(false)}
                className={`block rounded-[10px] p-3 text-[15px] transition ${pathname === i.href ? "bg-surface-2 font-bold text-fg" : "text-muted hover:bg-surface hover:text-fg"}`}
              >
                {t(i.label)}
              </Link>
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-line-soft bg-bg px-4 md:px-8">
          <button className="rounded-lg px-2 py-1 text-xl text-muted hover:text-fg md:hidden" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher />
            <span className="hidden text-sm font-semibold text-muted sm:inline">{name}</span>
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
        <main className="flex-1 px-4 py-6 md:px-8 md:py-7">{children}</main>
      </div>
    </div>
  );
}
