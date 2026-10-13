"use client";

import { useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/require-auth";
import { Alert, Button, Spinner, cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime } from "@/lib/format";
import { session } from "@/lib/session";
import type { AppNotification } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function NotificationsPage() {
  return (
    <RequireAuth>
      <Notifications />
    </RequireAuth>
  );
}

function Notifications() {
  const { t } = useI18n();
  const { data, meta, loading, error, reload, setData } = useApi<AppNotification[]>("/notifications?limit=30");
  const [more, setMore] = useState(false);
  const cursor = (meta as { next_cursor?: string | null } | null)?.next_cursor ?? null;
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const nextCursor = next === undefined ? cursor : next;

  async function markAll() {
    await session.post("/notifications/read-all").catch(() => undefined);
    setData((d) => d?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? null);
  }

  async function open(n: AppNotification) {
    if (n.read_at) return;
    await session.patch(`/notifications/${n.id}/read`).catch(() => undefined);
    setData((d) => d?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setMore(true);
    try {
      const r = await session.get<AppNotification[]>(`/notifications?limit=30&cursor=${nextCursor}`);
      setData((d) => [...(d ?? []), ...r.data]);
      setNext((r.meta as { next_cursor?: string | null } | undefined)?.next_cursor ?? null);
    } finally {
      setMore(false);
    }
  }

  const hasUnread = data?.some((n) => !n.read_at);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-8 sm:px-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("notifications.title")}</h1>
        {hasUnread && (
          <Button variant="ghost" onClick={markAll}>
            {t("notifications.readAll")}
          </Button>
        )}
      </div>
      {loading && <Spinner className="mx-auto my-10 h-6 w-6" />}
      {error && (
        <Alert>
          {error}{" "}
          <button className="underline" onClick={reload}>
            {t("map.retry")}
          </button>
        </Alert>
      )}
      {!loading && data?.length === 0 && <div className="rounded-2xl border border-dashed border-line py-12 text-center text-muted">{t("notifications.empty")}</div>}
      <ul className="space-y-2">
        {data?.map((n) => {
          const href =
            typeof n.data?.booking_id === "string" ? `/bookings/${n.data.booking_id}` : typeof n.data?.ticket_id === "string" ? `/support/${n.data.ticket_id}` : null;
          const body = (
            <div className="flex gap-3">
              <span className={cx("mt-2 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className={cx("text-[15px]", n.read_at ? "font-semibold text-muted" : "font-bold")}>{n.title}</div>
                {n.body && <div className="mt-0.5 text-sm text-muted">{n.body}</div>}
                <div className="mt-1 text-xs text-muted">
                  {fmtDate(n.created_at, t)}, {fmtTime(n.created_at)}
                </div>
              </div>
            </div>
          );
          const cls = "block rounded-[18px] bg-surface p-4 transition hover:bg-surface-2";
          return (
            <li key={n.id}>
              {href ? (
                <Link href={href} className={cls} onClick={() => open(n)}>
                  {body}
                </Link>
              ) : (
                <button type="button" className={cx(cls, "w-full text-left")} onClick={() => open(n)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!loading && nextCursor && (
        <div className="text-center">
          <Button variant="secondary" loading={more} onClick={loadMore}>
            {t("notifications.more")}
          </Button>
        </div>
      )}
    </main>
  );
}
