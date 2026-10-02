"use client";

import { useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { DeviceLayout } from "@/lib/types";

export type LayoutTile = { id: string; name: string; room: { id: string; name: string } | null; layout: DeviceLayout | null; tone?: string; sub?: string };

const CELL = 76;
const MIN_COLS = 12;
const MIN_ROWS = 6;
export const LAYOUT_MAX = 100; // LayoutDto: x,y ∈ [0,100]

const key = (p: DeviceLayout) => `${p.x}:${p.y}`;

/** Joylashuvi yo'q qurilmalarga birinchi bo'sh katakni beradi (faqat ko'rsatish; saqlash — editor ishi). */
export function resolvePositions(tiles: LayoutTile[]): Record<string, DeviceLayout> {
  const out: Record<string, DeviceLayout> = {};
  const byRoom = new Map<string, LayoutTile[]>();
  for (const t of tiles) {
    const r = t.room?.id ?? "";
    byRoom.set(r, [...(byRoom.get(r) ?? []), t]);
  }
  for (const list of byRoom.values()) {
    const used = new Set<string>();
    for (const t of list) {
      if (t.layout && !used.has(key(t.layout))) {
        out[t.id] = { x: t.layout.x, y: t.layout.y };
        used.add(key(t.layout));
      }
    }
    let i = 0;
    for (const t of list) {
      if (out[t.id]) continue;
      let p: DeviceLayout;
      do {
        p = { x: i % MIN_COLS, y: Math.floor(i / MIN_COLS) };
        i++;
      } while (used.has(key(p)));
      out[t.id] = p;
      used.add(key(p));
    }
  }
  return out;
}

/** Zal sxemasi: xona bo'yicha grid, tile'lar absolyut joylashgan. editable bo'lsa drag + snap. */
export function HallLayout({
  devices,
  positions,
  onMove,
  onSelect,
}: {
  devices: LayoutTile[];
  positions?: Record<string, DeviceLayout>;
  onMove?: (id: string, p: DeviceLayout) => void;
  onSelect?: (id: string) => void;
}) {
  const { t } = useI18n();
  const pos = positions ?? resolvePositions(devices);
  const rooms = new Map<string, { name: string | null; list: LayoutTile[] }>();
  for (const d of devices) {
    const k = d.room?.id ?? "";
    const r = rooms.get(k) ?? { name: d.room?.name ?? null, list: [] };
    r.list.push(d);
    rooms.set(k, r);
  }
  return (
    <div className="space-y-4">
      {[...rooms.entries()].map(([id, r]) => (
        <div key={id || "none"} className="space-y-2">
          {(rooms.size > 1 || r.name) && <div className="text-sm font-bold text-muted">{r.name ?? t("layout.noRoom")}</div>}
          <RoomCanvas tiles={r.list} pos={pos} onMove={onMove} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

function RoomCanvas({ tiles, pos, onMove, onSelect }: { tiles: LayoutTile[]; pos: Record<string, DeviceLayout>; onMove?: (id: string, p: DeviceLayout) => void; onSelect?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  const maxX = Math.max(0, ...tiles.map((d) => pos[d.id]?.x ?? 0));
  const maxY = Math.max(0, ...tiles.map((d) => pos[d.id]?.y ?? 0));
  const cols = Math.min(LAYOUT_MAX + 1, Math.max(MIN_COLS, maxX + (onMove ? 3 : 1)));
  const rows = Math.min(LAYOUT_MAX + 1, Math.max(MIN_ROWS, maxY + (onMove ? 3 : 1)));

  const cellAt = (clientX: number, clientY: number, dx: number, dy: number): DeviceLayout => {
    const r = ref.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    return { x: clamp(Math.round((clientX - r.left - dx) / CELL), Math.min(LAYOUT_MAX, cols - 1)), y: clamp(Math.round((clientY - r.top - dy) / CELL), Math.min(LAYOUT_MAX, rows - 1)) };
  };

  return (
    <div className="overflow-auto rounded-2xl border border-line bg-surface">
      <div
        ref={ref}
        className="relative touch-none"
        style={{
          width: cols * CELL,
          height: rows * CELL,
          backgroundImage: "linear-gradient(to right, var(--color-line-soft, rgba(128,128,128,.15)) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line-soft, rgba(128,128,128,.15)) 1px, transparent 1px)",
          backgroundSize: `${CELL}px ${CELL}px`,
        }}
      >
        {tiles.map((d) => {
          const p = pos[d.id];
          if (!p) return null;
          const dragging = drag?.id === d.id;
          const left = dragging ? drag.x : p.x * CELL;
          const top = dragging ? drag.y : p.y * CELL;
          return (
            <button
              key={d.id}
              type="button"
              title={d.name}
              className={cx(
                "absolute flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 bg-bg p-1 text-center transition-shadow",
                d.tone ?? "border-line",
                onMove ? "cursor-grab" : onSelect ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
                dragging && "z-10 cursor-grabbing shadow-2xl",
              )}
              style={{ left: left + 4, top: top + 4, width: CELL - 8, height: CELL - 8 }}
              onClick={() => !onMove && onSelect?.(d.id)}
              onPointerDown={(e) => {
                if (!onMove) return;
                const r = ref.current!.getBoundingClientRect();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ id: d.id, dx: e.clientX - r.left - p.x * CELL, dy: e.clientY - r.top - p.y * CELL, x: p.x * CELL, y: p.y * CELL, moved: false });
              }}
              onPointerMove={(e) => {
                if (!drag || drag.id !== d.id) return;
                const r = ref.current!.getBoundingClientRect();
                setDrag({ ...drag, x: e.clientX - r.left - drag.dx, y: e.clientY - r.top - drag.dy, moved: true });
              }}
              onPointerUp={(e) => {
                if (!drag || drag.id !== d.id) return;
                if (drag.moved) onMove?.(d.id, cellAt(e.clientX, e.clientY, drag.dx, drag.dy));
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
            >
              <b className="w-full truncate text-xs text-fg">{d.name}</b>
              {d.sub && <span className="w-full truncate text-[10px] font-bold">{d.sub}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
