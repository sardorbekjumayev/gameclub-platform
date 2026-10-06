"use client";

import { formatMoney } from "@gc/types";
import Link from "next/link";
import { useState } from "react";
import { RENTAL_TONE, RentalThumb } from "@/components/rental-card";
import { RequireAuth } from "@/components/require-auth";
import { Alert, Badge, Chip, Spinner } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime } from "@/lib/format";
import type { RentalOrder } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function MyRentalsPage() {
  return (
    <RequireAuth>
      <MyRentals />
    </RequireAuth>
  );
}

function MyRentals() {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"OPEN" | "HISTORY">("OPEN");
  const { data, loading, error, reload } = useApi<RentalOrder[]>(`/rentals?status=${tab}&limit=50`);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("rent.mine")}</h1>
        <Link href="/rentals" className="text-sm font-bold text-accent hover:underline">
          {t("rent.browse")}
        </Link>
      </div>
      <div className="flex gap-2">
        {(["OPEN", "HISTORY"] as const).map((k) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)}>
            {t(`rent.tab.${k}` as MessageKey)}
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
          <p>{t(tab === "OPEN" ? "rent.emptyOpen" : "rent.emptyHistory")}</p>
          <Link href="/rentals" className="font-bold text-accent hover:underline">
            {t("rent.browse")}
          </Link>
        </div>
      )}
      <div className="space-y-3">
        {!loading &&
          data?.map((r) => {
            const tz = r.branch?.timezone;
            return (
              <Link key={r.id} href={`/my-rentals/${r.id}`} className="flex gap-4 rounded-[18px] bg-surface p-4 transition hover:bg-surface-2">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                  <RentalThumb item={r.item_snapshot} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold">
                        {r.item_snapshot.name}
                        {r.quantity > 1 && <span className="text-muted"> × {r.quantity}</span>}
                      </div>
                      <div className="truncate text-sm text-muted">{r.branch?.club.name}</div>
                    </div>
                    <Badge tone={r.is_overdue ? "red" : RENTAL_TONE[r.status]}>{r.is_overdue ? t("rent.overdue") : t(`rentalStatus.${r.status}` as MessageKey)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
                    <span>
                      {fmtDate(r.start_at, t, tz)}, {fmtTime(r.start_at, tz)} → {fmtDate(r.end_at, t, tz)}, {fmtTime(r.end_at, tz)}
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(r.total_amount, locale)}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted">{r.code}</div>
                </div>
              </Link>
            );
          })}
      </div>
    </main>
  );
}
