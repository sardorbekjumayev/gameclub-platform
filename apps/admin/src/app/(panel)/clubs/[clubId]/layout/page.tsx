"use client";

import { formatMoney } from "@gc/types";
import { Eraser, Minus, MousePointer2, Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { BranchPicker, ClubHeader } from "@/components/club-tabs";
import { DECOR_ICON, DECOR_KINDS, type Decor, DecorCell, type DecorKind, RoomGrid, SEAT_CELL, type Seat, SeatButton, useSeatDrag } from "@/components/room-editor";
import { cx } from "@/components/ui";
import { Empty, LoadState } from "@/components/status";
import { Alert, Badge, Button, Card, Input, Select } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { useMyClub } from "@/lib/my-club";
import { session, useAuth } from "@/lib/session";
import type { Device, Room, Tariff } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "border-accent text-accent",
  MAINTENANCE: "border-warn text-warn",
  DISABLED: "border-line text-muted opacity-70",
};
const ROOM_TYPES = ["STANDARD", "VIP", "BOOTCAMP", "CONSOLE", "STREAM"] as const;
const GRID_MIN = 2;
const GRID_MAX = 40;

/** Xonalar va o'rindiqlar sxemasi: xona qo'shish/kengaytirish, tarif biriktirish, qurilmalarni sudrab joylash. */
export default function LayoutPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { branches, loading } = useMyClub(clubId);
  const [picked, setPicked] = useState<string | null>(null);
  const branchId = picked ?? branches[0]?.id ?? null;
  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      {!loading && branches.length === 0 && <Empty>{t("branch.empty")}</Empty>}
      {branches.length > 1 && <BranchPicker branches={branches} value={branchId} onChange={setPicked} />}
      {branchId && <BranchRooms key={branchId} branchId={branchId} />}
    </div>
  );
}

function BranchRooms({ branchId }: { branchId: string }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const editable = can("devices.update");
  const devices = useApi<Device[]>(`/branches/${branchId}/devices`);
  const rooms = useApi<Room[]>(`/branches/${branchId}/rooms`);
  const tariffs = useApi<Tariff[]>(can("tariffs.view") ? `/branches/${branchId}/tariffs/manage` : null);
  const [draft, setDraft] = useState<Record<string, Seat> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [newRoom, setNewRoom] = useState<{ name: string; type: string } | null>(null);
  const [decorDraft, setDecorDraft] = useState<Record<string, Decor[]> | null>(null);
  const [tool, setTool] = useState<DecorKind | "ERASE" | null>(null);
  const paintMode = useRef<"add" | "remove">("add");

  const list = devices.data ?? [];
  const roomList = rooms.data ?? [];
  const tariffList = tariffs.data ?? [];

  const saved: Record<string, Seat> = Object.fromEntries(
    list.map((d) => [d.id, { room: d.room?.id ?? null, x: d.layout?.x ?? 0, y: d.layout?.y ?? 0 }]),
  );
  const seats = draft ?? saved;

  // Bir katakka ikki qurilma tushmasin: xonaga sig'magan yoki to'qnashganlarni bo'sh katakka suramiz
  const placed: Record<string, Seat> = {};
  for (const r of roomList) {
    const used = new Set<string>();
    const inRoom = list.filter((d) => seats[d.id]?.room === r.id);
    const later: Device[] = [];
    for (const d of inRoom) {
      const s = seats[d.id];
      const k = `${s.x}:${s.y}`;
      if (s.x < r.grid_cols && s.y < r.grid_rows && !used.has(k)) {
        used.add(k);
        placed[d.id] = s;
      } else later.push(d);
    }
    let i = 0;
    for (const d of later) {
      while (i < r.grid_cols * r.grid_rows && used.has(`${i % r.grid_cols}:${Math.floor(i / r.grid_cols)}`)) i++;
      if (i >= r.grid_cols * r.grid_rows) break; // joy yo'q — tray'da qoladi
      placed[d.id] = { room: r.id, x: i % r.grid_cols, y: Math.floor(i / r.grid_cols) };
      used.add(`${placed[d.id].x}:${placed[d.id].y}`);
    }
  }
  const tray = list.filter((d) => !placed[d.id]);
  const decorOf = (r: Room): Decor[] => decorDraft?.[r.id] ?? ((r.decor ?? []) as Decor[]);
  const dirty = !!draft || !!decorDraft;

  // Katakni bo'yash: birinchi bosishda qo'shish/o'chirish rejimi aniqlanadi, sudraganda shu rejim davom etadi
  function paintCell(r: Room, x: number, y: number, first: boolean) {
    if (!tool) return;
    if (list.some((d) => placed[d.id]?.room === r.id && placed[d.id].x === x && placed[d.id].y === y)) return; // o'rindiq ustiga emas
    const cur = decorOf(r);
    const at = cur.find((d) => d.x === x && d.y === y);
    if (first) paintMode.current = tool === "ERASE" || at?.kind === tool ? "remove" : "add";
    const rest = cur.filter((d) => !(d.x === x && d.y === y));
    const next = paintMode.current === "remove" || tool === "ERASE" ? rest : [...rest, { kind: tool, x, y }];
    setDecorDraft({ ...(decorDraft ?? {}), [r.id]: next });
    setMsg(null);
  }

  const dnd = useSeatDrag((id, seat) => {
    const next = { ...placed };
    for (const d of tray) next[d.id] = { room: null, x: 0, y: 0 };
    const prev = next[id];
    if (seat.room) {
      const other = Object.entries(next).find(([k, s]) => k !== id && s.room === seat.room && s.x === seat.x && s.y === seat.y);
      if (other) next[other[0]] = prev; // joy almashtirish
    }
    next[id] = seat;
    setDraft(next);
    // O'rindiq qo'yilgan katakdagi bezak olib tashlanadi
    const room = seat.room ? roomList.find((r) => r.id === seat.room) : null;
    if (room && decorOf(room).some((d) => d.x === seat.x && d.y === seat.y)) {
      setDecorDraft({ ...(decorDraft ?? {}), [room.id]: decorOf(room).filter((d) => !(d.x === seat.x && d.y === seat.y)) });
    }
    setMsg(null);
  });

  async function run(fn: () => Promise<unknown>, reload: () => void) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    await run(
      async () => {
        for (const [roomId, decor] of Object.entries(decorDraft ?? {})) await session.patch(`/rooms/${roomId}`, { decor });
        if (draft) await session.put(`/branches/${branchId}/layout`, {
          items: list.map((d) => {
            const s = placed[d.id];
            return s ? { device_id: d.id, x: s.x, y: s.y, room_id: s.room } : { device_id: d.id, x: 0, y: 0, room_id: null };
          }),
        });
      },
      () => {
        setDraft(null);
        setDecorDraft(null);
        rooms.reload();
        setMsg({ tone: "success", text: t("common.saved") });
        devices.reload();
      },
    );
  }

  const resize = (r: Room, dc: number, dr: number) =>
    run(
      () =>
        session.patch(`/rooms/${r.id}`, {
          grid_cols: Math.max(GRID_MIN, Math.min(GRID_MAX, r.grid_cols + dc)),
          grid_rows: Math.max(GRID_MIN, Math.min(GRID_MAX, r.grid_rows + dr)),
        }),
      rooms.reload,
    );

  const setTariff = (roomId: string, tariffId: string) =>
    run(() => session.put(`/rooms/${roomId}/tariff`, { tariff_id: tariffId || null }), tariffs.reload);

  const removeRoom = (r: Room) => {
    if (!confirm(t("room.confirmDelete"))) return;
    void run(() => session.delete(`/rooms/${r.id}`), rooms.reload);
  };

  const createRoom = () => {
    if (!newRoom?.name.trim()) return;
    void run(() => session.post(`/branches/${branchId}/rooms`, { name: newRoom.name.trim(), type: newRoom.type }), () => {
      setNewRoom(null);
      rooms.reload();
    });
  };

  const seatTone = (d: Device) => STATUS_TONE[d.operational_status];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted">{editable ? t("seatmap.hintEdit") : t("layout.hintView")}</p>
        <div className="flex gap-2">
          {can("rooms.create") && (
            <Button variant="secondary" onClick={() => setNewRoom({ name: "", type: "STANDARD" })} disabled={busy}>
              <Plus className="h-4 w-4" /> {t("seatmap.addRoom")}
            </Button>
          )}
          {editable && dirty && (
            <Button variant="secondary" onClick={() => (setDraft(null), setDecorDraft(null))} disabled={busy}>
              {t("layout.reset")}
            </Button>
          )}
          {editable && (
            <Button onClick={save} loading={busy} disabled={!dirty}>
              {t("common.save")}
            </Button>
          )}
        </div>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {editable && can("rooms.update") && roomList.length > 0 && (
        <Card className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <ToolButton active={!tool} onClick={() => setTool(null)} icon={MousePointer2} label={t("seatmap.tool.move")} />
            <span className="mx-1 h-6 w-px bg-line" />
            {DECOR_KINDS.map((k) => (
              <ToolButton key={k} active={tool === k} onClick={() => setTool(k)} icon={DECOR_ICON[k]} label={t(`seatmap.decor.${k}` as never)} />
            ))}
            <ToolButton active={tool === "ERASE"} onClick={() => setTool("ERASE")} icon={Eraser} label={t("seatmap.tool.erase")} />
          </div>
          <p className="text-xs text-muted">{tool ? t("seatmap.tool.paintHint") : t("seatmap.tool.moveHint")}</p>
        </Card>
      )}

      {newRoom && (
        <Card className="flex flex-wrap items-end gap-3">
          <Input autoFocus className="w-56" placeholder={t("room.name")} value={newRoom.name} maxLength={80} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && createRoom()} />
          <Select className="w-40" value={newRoom.type} onChange={(e) => setNewRoom({ ...newRoom, type: e.target.value })}>
            {ROOM_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`room.type.${x}` as never)}
              </option>
            ))}
          </Select>
          <Button onClick={createRoom} loading={busy} disabled={!newRoom.name.trim()}>
            {t("seatmap.create")}
          </Button>
          <Button variant="secondary" onClick={() => setNewRoom(null)}>
            {t("common.cancel")}
          </Button>
        </Card>
      )}

      <LoadState loading={(devices.loading && !devices.data) || (rooms.loading && !rooms.data)} error={devices.error ?? rooms.error} onRetry={() => (devices.reload(), rooms.reload())} />
      {rooms.data && roomList.length === 0 && <Empty>{t("seatmap.noRooms")}</Empty>}

      {roomList.map((r) => {
        const roomTariff = tariffList.find((x) => x.room_id === r.id);
        const inRoom = list.filter((d) => placed[d.id]?.room === r.id);
        return (
          <Card key={r.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="font-display text-lg font-bold">{r.name}</div>
              <Badge tone={r.type === "VIP" ? "violet" : "neutral"}>{t(`room.type.${r.type ?? "STANDARD"}` as never)}</Badge>
              <span className="text-sm text-muted">{t("seatmap.seatsN", { n: inRoom.length })}</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {can("tariffs.update") && (
                  <Select className="w-56" value={roomTariff?.id ?? ""} disabled={busy} onChange={(e) => setTariff(r.id, e.target.value)}>
                    <option value="">{t("seatmap.noTariff")}</option>
                    {tariffList.filter((x) => x.is_active || x.room_id === r.id).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} · {formatMoney(x.price_per_hour, locale)}/{t("seatmap.hour")}
                      </option>
                    ))}
                  </Select>
                )}
                {can("rooms.update") && (
                  <>
                    <SizeControl label={t("seatmap.width")} value={r.grid_cols} disabled={busy} onChange={(d) => resize(r, d, 0)} />
                    <SizeControl label={t("seatmap.height")} value={r.grid_rows} disabled={busy} onChange={(d) => resize(r, 0, d)} />
                  </>
                )}
                {can("rooms.delete") && (
                  <Button variant="secondary" size="sm" disabled={busy || inRoom.length > 0} title={inRoom.length ? t("seatmap.roomNotEmpty") : undefined} onClick={() => removeRoom(r)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <RoomGrid roomId={r.id} cols={r.grid_cols} rows={r.grid_rows} onCell={tool ? (x, y, first) => paintCell(r, x, y, first) : undefined}>
              {decorOf(r).map((d, i) => (
                <DecorCell key={`d${i}`} d={d} label={t(`seatmap.decor.${d.kind}` as never)} className="pointer-events-none" />
              ))}
              {inRoom.map((d) => {
                const s = placed[d.id];
                const dragging = dnd.drag?.id === d.id;
                return (
                  <SeatButton
                    key={d.id}
                    tile={{ id: d.id, name: d.name, tone: seatTone(d) }}
                    editable={editable}
                    dragging={dragging}
                    drag={dnd.drag}
                    style={{ left: s.x * SEAT_CELL + 4, top: s.y * SEAT_CELL + 4 }}
                    className={cx("absolute", tool && "pointer-events-none")}
                    onPointerDown={editable ? (e) => dnd.start(d.id, e) : undefined}
                    onPointerMove={editable ? dnd.move : undefined}
                    onPointerUp={editable ? dnd.end : undefined}
                    onPointerCancel={dnd.cancel}
                  />
                );
              })}
            </RoomGrid>
          </Card>
        );
      })}

      {list.length > 0 && (
        <Card className="space-y-3">
          <div>
            <div className="font-display text-lg font-bold">{t("seatmap.tray")}</div>
            <p className="text-sm text-muted">{t("seatmap.trayHint")}</p>
          </div>
          <div data-room="" className="flex min-h-[72px] flex-wrap gap-2 rounded-2xl border border-dashed border-line p-2">
            {tray.length === 0 && <span className="self-center px-2 text-sm text-muted">{t("seatmap.trayEmpty")}</span>}
            {tray.map((d) => (
              <SeatButton
                key={d.id}
                tile={{ id: d.id, name: d.name, tone: seatTone(d) }}
                editable={editable}
                dragging={dnd.drag?.id === d.id}
                drag={dnd.drag}
                onPointerDown={editable ? (e) => dnd.start(d.id, e) : undefined}
                onPointerMove={editable ? dnd.move : undefined}
                onPointerUp={editable ? dnd.end : undefined}
                onPointerCancel={dnd.cancel}
              />
            ))}
          </div>
        </Card>
      )}
      {devices.data && list.length === 0 && <Empty>{t("device.empty")}</Empty>}
    </div>
  );
}

function SizeControl({ label, value, disabled, onChange }: { label: string; value: number; disabled?: boolean; onChange: (delta: number) => void }) {
  return (
    <div className="flex h-9 items-center gap-1 rounded-xl border border-line bg-surface-2 px-1 text-sm">
      <span className="px-1 text-muted">{label}</span>
      <button type="button" className="rounded-lg p-1 hover:bg-surface disabled:opacity-40" disabled={disabled || value <= GRID_MIN} onClick={() => onChange(-1)}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <b className="w-6 text-center tabular-nums">{value}</b>
      <button type="button" className="rounded-lg p-1 hover:bg-surface disabled:opacity-40" disabled={disabled || value >= GRID_MAX} onClick={() => onChange(1)}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ToolButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold", active ? "bg-accent text-on-accent" : "border border-line bg-surface-2 hover:bg-surface")}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
