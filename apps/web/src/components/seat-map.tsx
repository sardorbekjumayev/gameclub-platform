"use client";

import { formatMoney } from "@gc/types";
import { BrickWall, DoorOpen, Footprints, type LucideIcon, Monitor, Toilet, Tv, Users, Wallet } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { AvailDevice, AvailRoom } from "@/lib/types";

const CELL = 48;

type DecorKind = NonNullable<AvailRoom["decor"]>[number]["kind"];
const DECOR_ICON: Record<DecorKind, LucideIcon> = { ENTRANCE: DoorOpen, CASHIER: Wallet, WALL: BrickWall, AISLE: Footprints, TV: Tv, WC: Toilet };
const DECOR_STYLE: Record<DecorKind, string> = {
  ENTRANCE: "rounded-lg border-2 border-dashed border-accent/70 bg-accent/10 text-accent",
  CASHIER: "rounded-lg border-2 border-warn/70 bg-warn/10 text-warn",
  WALL: "rounded-sm bg-line text-muted",
  AISLE: "rounded-sm border border-dashed border-line text-muted/60",
  TV: "rounded-lg border-2 border-line bg-surface-2 text-fg",
  WC: "rounded-lg border-2 border-line bg-surface-2 text-muted",
};

/**
 * O'rindiq sxemasi (avtobus chiptasidagi kabi): xona → katak → o'rindiq.
 * Bo'sh o'rindiqni bosib tanlaysiz; band / ishlamaydigan joylar bosilmaydi.
 */
export function SeatMap({
  rooms,
  devices,
  picked,
  max,
  onToggle,
  onPickGroup,
}: {
  rooms: AvailRoom[];
  devices: AvailDevice[];
  picked: string[];
  max: number;
  onToggle: (id: string) => void;
  onPickGroup: (ids: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const withSeats = rooms.filter((r) => r.total_count > 0);
  const loose = devices.filter((d) => !d.room || !rooms.some((r) => r.id === d.room!.id));
  const [roomId, setRoomId] = useState<string | null>(null);
  const active = withSeats.find((r) => r.id === roomId) ?? withSeats[0] ?? null;
  const full = picked.length >= max;
  const [group, setGroup] = useState<{ n: number; result: "adjacent" | "near" | "none" } | null>(null);

  // "Necha kishisiz?" — API taklif qilgan yonma-yon joylar: avval joriy xona, keyin qolganlari (yonma-yonlari ustun)
  function pickTogether(n: number) {
    const order = active ? [active, ...withSeats.filter((r) => r.id !== active.id)] : withSeats;
    const found = order.find((r) => r.together?.[n]?.adjacent) ?? order.find((r) => r.together?.[n]);
    const g = found?.together?.[n];
    if (!found || !g) return setGroup({ n, result: "none" });
    setRoomId(found.id);
    onPickGroup(g.device_ids);
    setGroup({ n, result: g.adjacent ? "adjacent" : "near" });
  }

  const seat = (d: AvailDevice, style?: React.CSSProperties) => {
    const free = d.status === "AVAILABLE" && !!d.price_quote;
    const on = picked.includes(d.id);
    const state = on ? "on" : free ? "free" : d.status === "UNAVAILABLE" ? "off" : "busy";
    return (
      <button
        key={d.id}
        type="button"
        disabled={!on && (!free || full)}
        onClick={() => onToggle(d.id)}
        title={`${d.name}${d.price_quote ? ` · ${formatMoney(d.price_quote.amount, locale)}` : ""} · ${t(`seat.${state}` as never)}`}
        aria-pressed={on}
        className={cx(
          "flex flex-col items-center justify-center rounded-lg border-2 text-[10px] font-bold leading-tight transition",
          state === "on" && "border-accent bg-accent text-on-accent shadow-[0_0_0_3px_rgba(198,255,61,.25)]",
          state === "free" && "border-accent/60 bg-surface-2 text-fg hover:border-accent hover:bg-accent/15",
          state === "free" && full && "cursor-not-allowed opacity-50",
          state === "busy" && "cursor-not-allowed border-danger/50 bg-danger/15 text-danger-soft",
          state === "off" && "cursor-not-allowed border-line bg-surface text-muted opacity-40",
        )}
        style={{ width: CELL - 6, height: CELL - 6, ...style }}
      >
        <Monitor className="h-3.5 w-3.5" />
        <span className="max-w-full truncate px-0.5">{d.name}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {withSeats.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-line-soft bg-surface-2/50 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Users className="h-4 w-4" /> {t("seat.together")}
            </span>
            {[2, 3, 4, 5].filter((n) => n <= max).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => pickTogether(n)}
                className={cx("h-8 min-w-8 rounded-lg px-2 text-sm font-bold", group?.n === n && group.result !== "none" ? "bg-accent text-on-accent" : "border border-line bg-surface-2 hover:border-accent")}
              >
                {n}
              </button>
            ))}
          </div>
          {group && <p className={cx("text-xs", group.result === "adjacent" ? "text-accent" : "text-muted")}>{t(`seat.together.${group.result}` as never, { n: group.n })}</p>}
        </div>
      )}
      {withSeats.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {withSeats.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRoomId(r.id)}
              className={cx("shrink-0 rounded-xl px-3 py-2 text-left text-xs", r.id === active?.id ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}
            >
              <div className="font-bold">
                {r.name}
                {r.type && r.type !== "STANDARD" && <span className="ml-1 opacity-70">· {t(`roomType.${r.type}` as never)}</span>}
              </div>
              <div className="opacity-80">{t("seat.freeOf", { n: r.available_count, total: r.total_count })}</div>
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="font-bold text-fg">
              {active.name}
              {active.tariff && <span className="ml-1 font-normal text-muted">· {active.tariff.name}</span>}
            </span>
            {active.price_from != null && <span className="text-muted">{t("seat.priceFrom", { price: formatMoney(active.price_from, locale) })}</span>}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-2">
            <div className="relative mx-auto" style={{ width: active.grid_cols * CELL, height: active.grid_rows * CELL }}>
              {(active.decor ?? []).map((d, i) => {
                const Icon = DECOR_ICON[d.kind];
                const full = d.kind === "WALL" || d.kind === "AISLE";
                return (
                  <div
                    key={`d${i}`}
                    title={t(`seat.decor.${d.kind}` as never)}
                    className={cx("absolute flex items-center justify-center", DECOR_STYLE[d.kind])}
                    style={full ? { left: d.x * CELL, top: d.y * CELL, width: CELL, height: CELL } : { left: d.x * CELL + 3, top: d.y * CELL + 3, width: CELL - 6, height: CELL - 6 }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                );
              })}
              {devices
                .filter((d) => d.room?.id === active.id)
                .map((d) => seat(d, { position: "absolute", left: (d.layout?.x ?? 0) * CELL + 3, top: (d.layout?.y ?? 0) * CELL + 3 }))}
            </div>
          </div>
        </div>
      )}

      {loose.length > 0 && (
        <div className="space-y-2">
          {active && <div className="text-xs font-bold text-muted">{t("seat.other")}</div>}
          <div className="flex flex-wrap gap-1.5">{loose.map((d) => seat(d))}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {(["free", "on", "busy", "off"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className={cx(
                "h-3 w-3 rounded border-2",
                s === "free" && "border-accent/60 bg-surface-2",
                s === "on" && "border-accent bg-accent",
                s === "busy" && "border-danger/50 bg-danger/15",
                s === "off" && "border-line bg-surface opacity-40",
              )}
            />
            {t(`seat.${s}` as never)}
          </span>
        ))}
      </div>
    </div>
  );
}
