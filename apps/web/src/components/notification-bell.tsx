"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";

/** O'qilmagan bildirishnomalar soni (60 s da yangilanadi). */
export function NotificationBell() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      session.get<{ count: number }>("/notifications/unread-count").then(
        (r) => alive && setCount(r.data.count),
        () => undefined,
      );
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pathname]);

  return (
    <Link href="/notifications" aria-label={t("notifications.title")} className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface hover:text-fg">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-[18px] text-on-accent tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
