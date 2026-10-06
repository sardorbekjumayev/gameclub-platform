"use client";

import { ClipboardList, Gamepad2, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { RentalCard } from "@/components/rental-card";
import { Alert, Chip, Input, Spinner } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";
import { RENTAL_TYPES, type RentalItem } from "@/lib/types";
import { useApi } from "@/lib/use-api";

/** Konsol arendasi katalogi: klublar uyga beradigan PS5/PS4/Xbox... (soatlik yoki kunlik). */
export default function RentalsPage() {
  const { t } = useI18n();
  const { me } = useAuth();
  const [type, setType] = useState<string | null>(null);
  const [unit, setUnit] = useState<"HOUR" | "DAY" | null>(null);
  const [delivery, setDelivery] = useState(false);
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ ...(type ? { type } : {}), ...(unit ? { rate_unit: unit } : {}), ...(delivery ? { delivery: "true" } : {}), ...(q.trim().length >= 2 ? { q: q.trim() } : {}) });
  const items = useApi<RentalItem[]>(`/rental-items?${params}`);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-8">
      <section className="relative overflow-hidden rounded-3xl border border-line-soft bg-surface p-6 sm:p-8">
        <div aria-hidden className="gc-hero-glow pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 text-sm font-bold text-accent">
              <Gamepad2 className="h-4 w-4" />
              {t("rent.kicker")}
            </div>
            <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{t("rent.title")}</h1>
            <p className="text-muted">{t("rent.subtitle")}</p>
          </div>
          {me && (
            <Link href="/my-rentals" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-bold transition hover:border-accent/50">
              <ClipboardList className="h-4 w-4 text-accent" />
              {t("rent.mine")}
            </Link>
          )}
        </div>
      </section>

      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("rent.search")} className="pl-10" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={!type} onClick={() => setType(null)}>
            {t("rent.allTypes")}
          </Chip>
          {RENTAL_TYPES.map((x) => (
            <Chip key={x} active={type === x} onClick={() => setType(type === x ? null : x)}>
              {t(`rentalType.${x}` as MessageKey)}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={unit === "HOUR"} onClick={() => setUnit(unit === "HOUR" ? null : "HOUR")}>
            {t("rent.hourly")}
          </Chip>
          <Chip active={unit === "DAY"} onClick={() => setUnit(unit === "DAY" ? null : "DAY")}>
            {t("rent.daily")}
          </Chip>
          <Chip active={delivery} onClick={() => setDelivery(!delivery)}>
            {t("rent.deliveryAvailable")}
          </Chip>
        </div>
      </div>

      {items.loading && <Spinner className="mx-auto my-12 h-6 w-6" />}
      {items.error && (
        <Alert>
          {items.error}{" "}
          <button className="underline" onClick={items.reload}>
            {t("map.retry")}
          </button>
        </Alert>
      )}
      {!items.loading && items.data?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line py-14 text-center text-muted">{t("rent.empty")}</div>
      )}
      {!items.loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.data?.map((it) => (
            <RentalCard key={it.id} item={it} />
          ))}
        </div>
      )}

      <section className="grid gap-3 pt-6 sm:grid-cols-3">
        {(["1", "2", "3"] as const).map((n) => (
          <div key={n} className="rounded-2xl border border-line-soft bg-surface p-5">
            <div className="font-display text-3xl font-bold text-accent">0{n}</div>
            <div className="mt-2 font-bold">{t(`rent.how.${n}.title` as MessageKey)}</div>
            <div className="text-sm text-muted">{t(`rent.how.${n}.text` as MessageKey)}</div>
          </div>
        ))}
      </section>
    </main>
  );
}
