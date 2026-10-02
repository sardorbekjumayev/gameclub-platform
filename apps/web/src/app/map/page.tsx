"use client";

import { ApiError, formatMoney } from "@gc/types";
import { Globe2, LocateFixed } from "lucide-react";
import Link from "next/link";
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

type Mode = "locating" | "near" | "all";

/** Ikki nuqta orasidagi masofa (km). */
function distanceKm(a: LatLng, b: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const WORLD = "-180,-90,180,90";

type State = { status: "loading" } | { status: "ready"; items: MapBranch[] } | { status: "unavailable" } | { status: "error" };

export default function MapPage() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [center, setCenter] = useState<LatLng | undefined>();
  const [zoom, setZoom] = useState(12);
  const [fit, setFit] = useState<LatLng[] | undefined>();
  const [me, setMe] = useState<LatLng | null>(null);
  const [mode, setMode] = useState<Mode>("locating");
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

  /** Joylashuv yo'q bo'lsa — barcha klublar xaritaga sig'diriladi. */
  const showAll = useCallback(() => {
    setMode("all");
    api.get<MapBranch[]>(`/branches/map?bbox=${WORLD}`).then(
      (r) => {
        setState({ status: "ready", items: r.data });
        setFit(r.data.map((b) => ({ lat: b.latitude, lng: b.longitude })));
      },
      (e) => setState(e instanceof ApiError && e.status === 404 ? { status: "unavailable" } : { status: "error" }),
    );
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return showAll();
    setMode("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMe(pos);
        setZoom(13);
        setCenter(pos);
        setMode("near");
      },
      () => showAll(),
      { timeout: 8000, maximumAge: 300_000 },
    );
  }, [showAll]);

  useEffect(locate, [locate]);

  const items = useMemo(() => {
    const list = state.status === "ready" ? state.items : [];
    return me ? [...list].sort((a, b) => distanceKm(me, { lat: a.latitude, lng: a.longitude }) - distanceKm(me, { lat: b.latitude, lng: b.longitude })) : list;
  }, [state, me]);
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
          <h1 className="font-display text-xl font-bold">{t(mode === "near" ? "map.nearby" : "map.all")}</h1>
          {state.status === "ready" && <span className="text-[13px] text-muted">{t("map.found", { n: items.length })}</span>}
        </div>
        <div className="flex gap-2">
          <Button variant={mode === "all" ? "primary" : "secondary"} size="sm" onClick={showAll}>
            <Globe2 className="h-4 w-4" />
            {t("map.showAll")}
          </Button>
          <Button variant={mode === "near" ? "primary" : "secondary"} size="sm" onClick={locate} disabled={mode === "locating"}>
            <LocateFixed className="h-4 w-4" />
            {t("map.nearMe")}
          </Button>
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
                {me && <span className="text-muted"> · {t("map.km", { km: distanceKm(me, { lat: b.latitude, lng: b.longitude }).toFixed(1) })}</span>}
              </div>
              {b.id === selected && (
                <Link href={`/clubs/${b.id}`} className="mt-1 text-[13px] font-bold text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                  {t("map.openClub")}
                </Link>
              )}
            </div>
          </button>
        ))}
      </aside>
      <MapView
        className="min-h-[55vh] flex-1"
        center={center}
        zoom={zoom}
        fit={fit}
        pin={me}
        markers={markers}
        onBoundsChange={load}
        onMarkerClick={setSelected}
      />
    </main>
  );
}
