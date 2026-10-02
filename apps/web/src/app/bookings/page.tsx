"use client";

import { formatMoney } from "@gc/types";
import Link from "next/link";
import { useState } from "react";
import { BOOKING_TONE, RequireAuth } from "@/components/require-auth";
import { Alert, Badge, Chip, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime } from "@/lib/format";
import type { BookingListItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function BookingsPage() {
  return (
    <RequireAuth>
      <Bookings />
    </RequireAuth>
  );
}

function Bookings() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"UPCOMING" | "PAST">("UPCOMING");
  const { data, loading, error, reload } = useApi<BookingListItem[]>(`/bookings?status=${tab}&limit=50`);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-8 sm:px-8">
      <h1 className="font-display text-3xl font-bold">{t("bookings.title")}</h1>
      <div className="flex gap-2">
        {(["UPCOMING", "PAST"] as const).map((k) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)}>
            {t(`bookings.tab.${k}` as never)}
          </Chip>
        ))}
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
      {!loading && data?.length === 0 && (
        <div className="space-y-3 rounded-2xl border border-dashed border-line py-12 text-center text-muted">
          <p>{t(tab === "UPCOMING" ? "bookings.emptyUpcoming" : "bookings.emptyPast")}</p>
          <Link href="/clubs" className="font-bold text-accent hover:underline">
            {t("bookings.findClub")}
          </Link>
        </div>
      )}
      <div className="space-y-3">
        {!loading &&
          data?.map((b) => (
            <Link key={b.id} href={`/bookings/${b.id}`} className="block rounded-[18px] bg-surface p-4 transition hover:bg-surface-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold">{b.branch.club.name}</div>
                  <div className="text-sm text-muted">{b.branch.name}</div>
                </div>
                <Badge tone={BOOKING_TONE[b.status]}>{t(`bookingStatus.${b.status}` as never)}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
                <span>
                  {fmtDate(b.start_at, t, b.branch.timezone)}, {fmtTime(b.start_at, b.branch.timezone)}–{fmtTime(b.end_at, b.branch.timezone)} · {b.devices.map((d) => d.name).join(", ")}
                </span>
                <span className="font-semibold tabular-nums">{formatMoney(b.total_amount, locale)}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-muted">{b.code}</div>
            </Link>
          ))}
      </div>
    </main>
  );
}
