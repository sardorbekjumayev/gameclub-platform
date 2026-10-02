"use client";

import { formatMoney } from "@gc/types";
import { Clock, Gamepad2, MapIcon, MapPin, Monitor, Navigation, Search, Star, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FavoriteButton, useFavorites } from "@/components/favorite-button";
import { Alert, Badge, Chip, Input, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtDistance } from "@/lib/format";
import type { BranchCard } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const DEVICE_FILTERS = ["PC", "PS5", "PS4", "XBOX", "RACING_SIMULATOR"] as const;
const SORTS = ["distance", "price", "rating", "popularity"] as const;

/** Klublar katalogi (docs/01-API.md §6.7): qidiruv, filtrlar, masofa bo'yicha. */
export default function ClubsPage() {
  return (
    <Suspense fallback={<Spinner className="mx-auto my-10 h-6 w-6" />}>
      <Clubs />
    </Suspense>
  );
}

function Clubs() {
  const { t, locale } = useI18n();
  // Bosh sahifadan kelgan filtrlar: /clubs?q=...&device=PS5
  const sp = useSearchParams();
  const initialDevice = sp.get("device");
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const [openNow, setOpenNow] = useState(false);
  const [availableNow, setAvailableNow] = useState(false);
  const [device, setDevice] = useState<string | null>(initialDevice && (DEVICE_FILTERS as readonly string[]).includes(initialDevice) ? initialDevice : null);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("distance");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);

  // Joylashuv ruxsat berilsa — masofa bo'yicha; berilmasa reyting bo'yicha
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => undefined,
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, []);

  const params = new URLSearchParams({ limit: "50", sort: pos || sort !== "distance" ? sort : "rating" });
  if (pos) {
    params.set("lat", pos.lat.toFixed(5));
    params.set("lng", pos.lng.toFixed(5));
  }
  if (query) params.set("q", query);
  if (openNow) params.set("open_now", "true");
  if (availableNow) params.set("available_now", "true");
  if (device) params.set("device_type", device);
  const fav = useFavorites();
  const { data, loading, error, reload } = useApi<BranchCard[]>(`/discovery/search?${params}`);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("clubs.title")}</h1>
        <Link href="/map" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-sm font-semibold text-accent transition hover:border-accent/60">
          <MapIcon className="h-4 w-4" />
          {t("clubs.onMap")}
        </Link>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("clubs.searchPlaceholder")} className="pl-12" />
        </div>
      </form>
      <div className="flex flex-wrap gap-2">
        <Chip active={openNow} onClick={() => setOpenNow((v) => !v)}>
          <Clock className="mr-1 inline h-3.5 w-3.5" />
          {t("clubs.openNow")}
        </Chip>
        <Chip active={availableNow} onClick={() => setAvailableNow((v) => !v)}>
          <Zap className="mr-1 inline h-3.5 w-3.5" />
          {t("clubs.availableNow")}
        </Chip>
        {DEVICE_FILTERS.map((d) => (
          <Chip key={d} active={device === d} onClick={() => setDevice(device === d ? null : d)}>
            {t(`deviceType.${d}` as never)}
          </Chip>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as (typeof SORTS)[number])}
          className="h-9 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold"
          aria-label={t("clubs.sort")}
        >
          {SORTS.map((s) => (
            <option key={s} value={s} disabled={s === "distance" && !pos}>
              {t(`clubs.sort.${s}` as never)}
            </option>
          ))}
        </select>
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
      {fav.error && <Alert>{fav.error}</Alert>}
      {!loading && data?.length === 0 && <div className="rounded-2xl border border-dashed border-line py-12 text-center text-muted">{t("clubs.empty")}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!loading &&
          data?.map((b) => (
            <Link key={b.id} href={`/clubs/${b.id}`} className="group overflow-hidden rounded-[18px] border border-line-soft bg-surface transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface-2">
              <div className="relative h-36 bg-surface-3">
                {b.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.cover_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-3 via-surface-2 to-accent/20">
                    <Gamepad2 className="h-12 w-12 text-accent/60 transition group-hover:scale-110" />
                  </div>
                )}
                <span className="absolute left-3 top-3">
                  <Badge tone={b.is_open_now ? "green" : "red"}>{b.is_open_now ? t("clubs.open") : t("clubs.closed")}</Badge>
                </span>
                <FavoriteButton branchId={b.id} fav={fav} className="absolute right-3 top-3" />
              </div>
              <div className="space-y-1.5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold">{b.club_name}</div>
                  {b.rating_count > 0 && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold">
                      <Star className="h-4 w-4 fill-warn text-warn" />
                      {b.rating_avg.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex items-start gap-1.5 text-sm text-muted">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {b.name} · {b.address}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  {b.distance_m != null && (
                    <span className="inline-flex items-center gap-1">
                      <Navigation className="h-3.5 w-3.5" />
                      {fmtDistance(b.distance_m, locale)}
                    </span>
                  )}
                  {b.total_devices > 0 && (
                    <span className="inline-flex items-center gap-1 font-bold text-accent">
                      <Monitor className="h-3.5 w-3.5" />
                      {t("map.free", { n: b.free_devices })}
                    </span>
                  )}
                  {b.price_from != null && (
                    <span className="inline-flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5" />
                      {t("map.priceFrom", { price: formatMoney(b.price_from, locale) })}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
      </div>
    </main>
  );
}
