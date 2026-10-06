"use client";

import { formatMoney } from "@gc/types";
import { Gamepad2, Glasses, MapPin, Truck } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import type { RentalItem } from "@/lib/types";

/** Konsol rasmi bo'lmasa — tur ikonkasi. */
export function RentalThumb({ item, className = "h-full w-full" }: { item: { type: string; image_url: string | null }; className?: string }) {
  const Icon = item.type === "VR" ? Glasses : Gamepad2;
  if (item.image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.image_url} alt="" className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} grid place-items-center bg-gradient-to-br from-accent/20 via-surface-2 to-surface-3 text-accent`}>
      <Icon className="h-1/3 w-1/3" strokeWidth={1.5} />
    </div>
  );
}

/** "20 000 so'm / soat · 150 000 so'm / kun" */
export function RentalPrices({ item, className }: { item: Pick<RentalItem, "price_per_hour" | "price_per_day">; className?: string }) {
  const { t, locale } = useI18n();
  return (
    <div className={className}>
      {item.price_per_hour != null && (
        <span className="whitespace-nowrap">
          <b className="font-display text-lg text-fg tabular-nums">{formatMoney(item.price_per_hour, locale)}</b>
          <span className="text-muted"> / {t("rent.hour")}</span>
        </span>
      )}
      {item.price_per_hour != null && item.price_per_day != null && <span className="mx-2 text-muted">·</span>}
      {item.price_per_day != null && (
        <span className="whitespace-nowrap">
          <b className="font-display text-lg text-fg tabular-nums">{formatMoney(item.price_per_day, locale)}</b>
          <span className="text-muted"> / {t("rent.day")}</span>
        </span>
      )}
    </div>
  );
}

export function RentalCard({ item, showClub = true }: { item: RentalItem; showClub?: boolean }) {
  const { t } = useI18n();
  return (
    <Link href={`/rentals/${item.id}`} className="group overflow-hidden rounded-[20px] border border-line-soft bg-surface transition hover:-translate-y-1 hover:border-accent/40">
      <div className="relative aspect-[16/10] overflow-hidden">
        <RentalThumb item={item} className="h-full w-full transition duration-300 group-hover:scale-[1.03]" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          <Badge tone={item.available_now > 0 ? "green" : "red"}>{item.available_now > 0 ? t("rent.availableN", { n: item.available_now }) : t("rent.busyNow")}</Badge>
        </div>
      </div>
      <div className="space-y-2 p-4">
        <div className="text-xs font-bold uppercase tracking-widest text-accent">{t(`rentalType.${item.type}` as MessageKey)}</div>
        <div className="font-display text-lg font-bold leading-snug">{item.name}</div>
        {showClub && (
          <div className="flex items-start gap-1.5 text-sm text-muted">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="line-clamp-1">
              {item.branch.club.name} · {item.branch.name}
            </span>
          </div>
        )}
        <RentalPrices item={item} className="flex flex-wrap items-baseline text-sm" />
        {item.delivery_available && (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Truck className="h-3.5 w-3.5" />
            {t("rent.deliveryAvailable")}
          </div>
        )}
      </div>
    </Link>
  );
}

export const RENTAL_TONE: Record<string, "neutral" | "green" | "red" | "amber" | "violet"> = {
  REQUESTED: "amber",
  CONFIRMED: "green",
  ACTIVE: "violet",
  RETURNED: "neutral",
  CANCELLED: "neutral",
  REJECTED: "red",
  EXPIRED: "neutral",
};
