"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/provider";
import { MapView, mapProvider } from "./map-view";
import type { LatLng } from "./provider";

/**
 * Filial joylashuvini tanlash: xaritaga bosiladi → pin + manzil (teskari geokodlash).
 * Filial formasi (Phase 2) `latitude/longitude` (majburiy) va `address` ni shu yerdan oladi.
 */
export function LocationPicker({
  value,
  onChange,
  className,
}: {
  value: LatLng | null;
  onChange: (pos: LatLng, address: string | null) => void;
  className?: string;
}) {
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);

  return (
    <div className={className}>
      <MapView
        className="h-80 rounded-2xl"
        center={value ?? undefined}
        pin={value}
        onMapClick={async (pos) => {
          setBusy(true);
          onChange(pos, null);
          const address = await mapProvider.reverseGeocode(pos, locale).catch(() => null);
          onChange(pos, address);
          setBusy(false);
        }}
      />
      {value && (
        <div className="mt-2 font-mono text-xs text-muted">
          {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
          {busy && " …"}
        </div>
      )}
    </div>
  );
}
