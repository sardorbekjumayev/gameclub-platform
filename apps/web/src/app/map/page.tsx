"use client";

import { ApiError, formatMoney } from "@gc/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "@/components/map/map-view";
import type { BBox, LatLng, MapMarker } from "@/components/map/provider";
import { Button, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { api } from "@/lib/api";

/** `GET /branches/map?bbox=w,s,e,n` elementi (docs/01-API.md §6.7). */
type MapBranch = {
  id: string;
  name: string;
  club_name: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  price_from?: number | null;
  rating_avg?: number | null;
  free_devices?: number | null;
};

type State = { status: "loading" } | { status: "ready"; items: MapBranch[] } | { status: "unavailable" } | { status: "error" };

export default function MapPage() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [center, setCenter] = useState<LatLng | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastBBox = useRef<BBox | null>(null);

  const load = useCallback((bbox: BBox, zoom: number) => {
    lastBBox.current = bbox;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.get<MapBranch[]>(`/branches/map?bbox=${bbox.map((n) => n.toFixed(5)).join(",")}&zoom=${zoom}`).then(
        (r) => setState({ status: "ready", items: r.data }),
        // Discovery API hali yo'q bo'lsa (Phase 2), xarita baribir ishlaydi — bo'sh holat ko'rsatiladi.
        (e) => setState(e instanceof ApiError && e.status === 404 ? { status: "unavailable" } : { status: "error" }),
      );
    }, 350);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const items = useMemo(() => (state.status === "ready" ? state.items : []), [state]);
  const markers = useMemo<MapMarker[]>(
    () =>
      items.map((b) => ({
        id: b.id,
        position: { lat: b.latitude, lng: b.longitude },
        label: b.price_from != null ? formatMoney(b.price_from, locale).replace(/\s\S+$/, "") : b.club_name,
        active: b.id === selected,
      })),
    [items, selected, locale],
  );

  return (
    <main className="flex flex-1 flex-col-reverse lg:flex-row">
      <aside className="flex flex-col gap-3.5 bg-surface p-5 lg:w-[400px] lg:shrink-0 lg:overflow-y-auto">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-xl font-bold">{t("map.nearby")}</h1>
          {state.status === "ready" && <span className="text-[13px] text-muted">{t("map.found", { n: items.length })}</span>}
        </div>
        {state.status === "loading" && <Spinner className="mx-auto my-8 h-5 w-5" />}
        {state.status === "error" && (
          <div className="space-y-3 py-6 text-center text-sm text-muted">
            <p>{t("map.error")}</p>
            <Button variant="secondary" size="sm" onClick={() => lastBBox.current && load(lastBBox.current, 12)}>
              {t("map.retry")}
            </Button>
          </div>
        )}
        {(state.status === "unavailable" || (state.status === "ready" && items.length === 0)) && (
          <p className="py-6 text-center text-sm text-muted">{t(state.status === "unavailable" ? "map.soon" : "map.empty")}</p>
        )}
        {items.map((b) => (
          <button
            key={b.id}
            onClick={() => {
              setSelected(b.id);
              setCenter({ lat: b.latitude, lng: b.longitude });
            }}
            className={`flex gap-3.5 rounded-2xl p-3.5 text-left transition ${b.id === selected ? "bg-surface-3 ring-1 ring-accent" : "bg-surface-2 hover:bg-surface-3"}`}
          >
            <div className="h-[72px] w-[72px] shrink-0 rounded-xl bg-line" />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="truncate font-bold">
                {b.club_name} — {b.name}
              </div>
              {b.address && <div className="truncate text-[13px] text-muted">{b.address}</div>}
              <div className="text-[13px]">
                {b.free_devices != null && <span className="font-bold text-accent">{t("map.free", { n: b.free_devices })}</span>}
                {b.free_devices != null && b.price_from != null && " · "}
                {b.price_from != null && t("map.priceFrom", { price: formatMoney(b.price_from, locale) })}
              </div>
            </div>
          </button>
        ))}
      </aside>
      <MapView
        className="min-h-[55vh] flex-1"
        center={center}
        markers={markers}
        onBoundsChange={load}
        onMarkerClick={setSelected}
      />
    </main>
  );
}
