"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { type LatLng, type MapEvents, type MapHandle, type MapMarker, TASHKENT } from "./provider";
import { yandexMaps } from "./yandex";

export const mapProvider = yandexMaps;

/** Provayderdan mustaqil xarita komponenti. Hodisa callbacklari ref orqali — qayta yaratilmaydi. */
export function MapView({
  center = TASHKENT,
  zoom = 12,
  markers,
  pin,
  className,
  ...events
}: { center?: LatLng; zoom?: number; markers?: MapMarker[]; pin?: LatLng | null; className?: string } & MapEvents) {
  const { t, locale } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const ev = useRef(events);
  useEffect(() => {
    ev.current = events;
  });

  useEffect(() => {
    let alive = true;
    let h: MapHandle | null = null;
    mapProvider
      .create(el.current!, {
        center,
        zoom,
        locale,
        onBoundsChange: (b, z) => ev.current.onBoundsChange?.(b, z),
        onMarkerClick: (id) => ev.current.onMarkerClick?.(id),
        onMapClick: (p) => ev.current.onMapClick?.(p),
      })
      .then(
        (created) => {
          if (!alive) return created.destroy();
          h = created;
          setHandle(created);
        },
        () => alive && setFailed(true),
      );
    return () => {
      alive = false;
      h?.destroy();
    };
    // Xarita bir marta yaratiladi; markaz/zoom keyin handle orqali o'zgaradi.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    handle?.setCenter({ lat: center.lat, lng: center.lng });
  }, [handle, center.lat, center.lng]);

  useEffect(() => {
    handle?.setMarkers(markers ?? []);
  }, [handle, markers]);

  useEffect(() => {
    if (pin !== undefined) handle?.setPin(pin);
  }, [handle, pin]);

  return (
    <div className={`gc-map relative overflow-hidden bg-surface ${className ?? ""}`}>
      <div ref={el} className="absolute inset-0" />
      {!handle && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          {failed ? t("map.loadError") : <Spinner />}
        </div>
      )}
    </div>
  );
}
