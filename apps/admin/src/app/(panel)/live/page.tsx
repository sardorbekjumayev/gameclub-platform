"use client";

import { formatMoney } from "@gc/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BranchPicker } from "@/components/club-tabs";
import { DevicePanel, Modal, WalkInForm, isShiftRequired, remainingNow } from "@/components/live/device-panel";
import { QrScanner } from "@/components/live/qr-scanner";
import { ShiftPanel } from "@/components/live/shift-panel";
import { fmtClock, fmtTime } from "@/components/live/time";
import { Empty, LoadState } from "@/components/status";
import { HallLayout } from "@/components/hall-layout";
import { Alert, Button, Card, Chip, Heading, Input, Stat, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { useLiveBranch } from "@/lib/live-socket";
import { session, useAuth } from "@/lib/session";
import type { LiveDevice, LiveSnapshot, MyClub, Occupancy } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

const BRANCH_KEY = "gc.live.branch";

const TONE: Record<Occupancy, { border: string; label: string; tile: string }> = {
  AVAILABLE: { border: "border-accent", label: "text-accent", tile: "border-accent text-accent" },
  OCCUPIED: { border: "border-danger", label: "text-danger-soft", tile: "border-danger text-danger-soft" },
  RESERVED: { border: "border-warn", label: "text-warn", tile: "border-warn text-warn" },
  UNAVAILABLE: { border: "border-line opacity-70", label: "text-muted", tile: "border-line text-muted opacity-70" },
};

/** Operator live board (docs/01-API.md §6.11, designn/admin-live.html). */
export default function LivePage() {
  const { t } = useI18n();
  const clubs = useApi<MyClub[]>("/clubs/mine");
  const branches = useMemo(
    () => (clubs.data ?? []).filter((c) => c.status === "ACTIVE" || c.status === "SUSPENDED").flatMap((c) => c.branches.map((b) => ({ id: b.id, name: clubs.data!.length > 1 ? `${c.name} · ${b.name}` : b.name }))),
    [clubs.data],
  );
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(BRANCH_KEY);
    } catch {
      return null;
    }
  });
  const branchId = branches.find((b) => b.id === picked)?.id ?? branches[0]?.id ?? null;

  const pick = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(BRANCH_KEY, id);
    } catch {
      /* storage yo'q */
    }
  };

  return (
    <div className="space-y-5">
      <LoadState loading={clubs.loading} error={clubs.error} onRetry={clubs.reload} />
      {!clubs.loading && branches.length === 0 && <Empty>{t("live.noBranches")}</Empty>}
      {branches.length > 1 && <BranchPicker branches={branches} value={branchId} onChange={pick} />}
      {branchId && <Board key={branchId} branchId={branchId} />}
    </div>
  );
}

function useTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Board({ branchId }: { branchId: string }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const live = useApi<LiveSnapshot>(`/branches/${branchId}/live`);
  const [skew, setSkew] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<"walkin" | "checkin" | "scan" | "shift" | null>(null);
  const [view, setView] = useState<"grid" | "map">("grid");
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const tick = useTick();
  const now = tick + skew;

  // Server va klient soati farqi (taymerlar server vaqti bo'yicha)
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  if (live.data && live.data.server_time !== syncedAt) {
    setSyncedAt(live.data.server_time);
    // tick — oxirgi soniya boshidagi klient vaqti (±1 s aniqlik taymer uchun yetarli)
    setSkew(new Date(live.data.server_time).getTime() - tick);
  }

  const { reload, setData } = live;
  const refresh = useCallback(() => {
    session.get<LiveSnapshot>(`/branches/${branchId}/live`).then((r) => setData(r.data), () => undefined);
  }, [branchId, setData]);
  const status = useLiveBranch(branchId, refresh);

  // WebSocket uzilgan bo'lsa — zaxira: har 20 s snapshot
  useEffect(() => {
    if (status === "live") return;
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [status, refresh]);

  const done = (text?: string) => {
    setSelected(null);
    setModal(null);
    if (text) setMsg({ tone: "success", text });
    refresh();
  };
  const shiftRequired = () => {
    setSelected(null);
    setModal("shift");
    setMsg({ tone: "info", text: t("shift.required") });
  };

  const d = live.data;
  const device = d?.devices.find((x) => x.id === selected) ?? null;
  const free = d?.devices.filter((x) => x.occupancy === "AVAILABLE") ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Heading>{d?.branch.name ?? "…"}</Heading>
          <span className={cx("inline-flex items-center gap-1.5 text-xs font-bold", status === "live" ? "text-accent" : "text-muted")}>
            <span className={cx("h-2 w-2 rounded-full", status === "live" ? "animate-pulse bg-accent" : "bg-muted")} />
            {t(`live.conn.${status}` as never)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("bookings.checkin") && (
            <Button variant="secondary" onClick={() => setModal("checkin")}>
              {t("live.checkIn")}
            </Button>
          )}
          {can("bookings.checkin") && (
            <Button variant="secondary" onClick={() => setModal("scan")}>
              {t("live.scan.button")}
            </Button>
          )}
          {(can("shifts.open") || d?.open_shift) && (
            <Button variant="secondary" onClick={() => setModal("shift")}>
              {d?.open_shift ? t("shift.title") : t("shift.open")}
            </Button>
          )}
          {can("bookings.create") && <Button onClick={() => setModal("walkin")}>{t("live.addWalkIn")}</Button>}
        </div>
      </div>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <LoadState loading={live.loading && !d} error={live.error} onRetry={reload} />

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("live.todayRevenue")} value={formatMoney(d.stats.today_revenue, locale)} accent />
            <Stat label={t("live.activeSessions")} value={d.stats.active_sessions} />
            <Stat label={t("live.freeDevices")} value={`${d.stats.free_devices} / ${d.stats.total_devices}`} />
            <Stat label={t("live.upcoming")} value={d.stats.upcoming_bookings} />
          </div>
          {!d.open_shift && can("shifts.open") && (
            <Alert tone="info">
              {t("shift.closedHint")}{" "}
              <button className="font-bold underline" onClick={() => setModal("shift")}>
                {t("shift.open")}
              </button>
            </Alert>
          )}

          {d.devices.length > 0 && (
            <div className="flex gap-2">
              <Chip active={view === "grid"} onClick={() => setView("grid")}>
                {t("live.view.grid")}
              </Chip>
              <Chip active={view === "map"} onClick={() => setView("map")}>
                {t("live.view.map")}
              </Chip>
            </div>
          )}
          {d.devices.length === 0 ? (
            <Empty>{t("device.empty")}</Empty>
          ) : view === "map" ? (
            <HallLayout
              devices={d.devices.map((x) => ({ id: x.id, name: x.name, room: x.room, layout: x.layout ?? null, tone: TONE[x.occupancy].tile, sub: x.occupancy === "UNAVAILABLE" ? t(`status.${x.operational_status}` as never) : t(`occupancy.${x.occupancy}` as never) }))}
              onSelect={(id) => setSelected(id)}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {d.devices.map((x) => (
                <DeviceCard key={x.id} d={x} now={now} onClick={() => setSelected(x.id)} />
              ))}
            </div>
          )}

          {d.upcoming.length > 0 && (
            <Card className="space-y-2">
              <div className="font-display text-lg font-bold">{t("live.upcomingList")}</div>
              <ul className="divide-y divide-line-soft text-sm">
                {d.upcoming.map((u) => (
                  <li key={`${u.booking_id}-${u.device_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-mono text-xs">
                        {fmtTime(u.start_at)}–{fmtTime(u.end_at)}
                      </span>{" "}
                      <b>{d.devices.find((x) => x.id === u.device_id)?.name}</b> · {u.customer_name ?? t("live.guest")}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted">{u.code}</span>
                      <span className="text-xs text-muted">{t(`bookingStatus.${u.status}` as never)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {device && d && (
        <DevicePanel device={device} branchId={branchId} freeDevices={free} now={now} onDone={done} onClose={() => setSelected(null)} onShiftRequired={shiftRequired} />
      )}
      {modal === "walkin" && d && <WalkInModal branchId={branchId} free={free} onDone={done} onClose={() => setModal(null)} onShiftRequired={shiftRequired} />}
      {(modal === "checkin" || modal === "scan") && <CheckInModal scan={modal === "scan"} onDone={done} onClose={() => setModal(null)} errorText={errorText} />}
      {modal === "shift" && <ShiftPanel branchId={branchId} shiftId={d?.open_shift?.id ?? null} onClose={() => setModal(null)} onChanged={refresh} />}
    </div>
  );
}

function DeviceCard({ d, now, onClick }: { d: LiveDevice; now: number; onClick: () => void }) {
  const { t } = useI18n();
  const tone = TONE[d.occupancy];
  const remaining = remainingNow(d, now);
  return (
    <button onClick={onClick} className={cx("rounded-2xl border bg-surface p-4 text-left transition hover:bg-surface-2", tone.border)}>
      <div className="flex items-center justify-between gap-2">
        <b className="truncate">{d.name}</b>
        <span className={cx("text-[13px] font-bold", tone.label)}>
          {d.occupancy === "UNAVAILABLE" ? t(`status.${d.operational_status}` as never) : t(`occupancy.${d.occupancy}` as never)}
        </span>
      </div>
      {d.occupancy === "OCCUPIED" && d.session ? (
        <>
          <div className="mt-1.5 truncate text-[13px] text-muted">{d.session.customer_name ?? t("live.guest")}</div>
          <div className={cx("mt-1 font-display text-xl font-bold tabular-nums", remaining !== null && remaining < 0 ? "text-danger-soft" : remaining !== null && remaining < 600 ? "text-warn" : "")}>
            {remaining === null ? "—" : fmtClock(remaining)}
            {d.session.status === "PAUSED" && <span className="ml-2 text-xs text-muted">⏸</span>}
          </div>
          {d.session.amount_due > 0 && <div className="mt-1 text-xs font-bold text-warn">{t("live.unpaid")}</div>}
        </>
      ) : d.occupancy === "RESERVED" && d.next_booking ? (
        <>
          <div className="mt-1.5 truncate text-[13px] text-muted">{d.next_booking.customer_name ?? t("live.guest")}</div>
          <div className="mt-1 text-sm">{t("live.startsAt", { time: fmtTime(d.next_booking.start_at) })}</div>
        </>
      ) : d.occupancy === "AVAILABLE" ? (
        <div className="mt-6 flex h-9 items-center justify-center rounded-[10px] border border-line text-[13px] font-semibold">{t("live.startSession")}</div>
      ) : (
        <div className="mt-1.5 text-[13px] text-muted">{d.category?.name ?? ""}</div>
      )}
      {d.occupancy === "AVAILABLE" && d.next_booking && <div className="mt-2 text-[11px] text-muted">{t("live.nextAt", { time: fmtTime(d.next_booking.start_at) })}</div>}
    </button>
  );
}

function WalkInModal({ branchId, free, onDone, onClose, onShiftRequired }: { branchId: string; free: LiveDevice[]; onDone: (m?: string) => void; onClose: () => void; onShiftRequired: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(_: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(success);
    } catch (e) {
      if (isShiftRequired(e)) onShiftRequired();
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("live.addWalkIn")} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {free.length === 0 ? (
          <Alert tone="info">{t("live.noFree")}</Alert>
        ) : (
          <>
            <div className="text-sm font-bold">{t("live.pickDevices")}</div>
            <div className="flex flex-wrap gap-2">
              {free.map((d) => {
                const on = ids.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setIds(on ? ids.filter((x) => x !== d.id) : ids.length < 10 ? [...ids, d.id] : ids)}
                    className={cx("h-10 rounded-xl px-3 text-sm font-bold", on ? "bg-accent text-on-accent" : "border border-line bg-surface")}
                  >
                    {d.name}
                  </button>
                );
              })}
            </div>
            {ids.length > 0 && <WalkInForm branchId={branchId} deviceIds={ids} busy={busy} run={run} />}
          </>
        )}
      </div>
    </Modal>
  );
}

function CheckInModal({ scan: initialScan, onDone, onClose, errorText }: { scan?: boolean; onDone: (m?: string) => void; onClose: () => void; errorText: (e: unknown) => string }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(!!initialScan);
  const [error, setError] = useState<string | null>(null);

  async function checkIn(payload: string) {
    setBusy(true);
    setError(null);
    try {
      await session.post("/bookings/check-in/scan", { qr_payload: payload.trim(), start_session: true }, { "Idempotency-Key": idemKey() });
      onDone(t("live.sessionStarted"));
    } catch (err) {
      const c = (err as { code?: string }).code;
      setError(c === "BOOKING_CHECKIN_WINDOW_CLOSED" ? t("live.checkInWindow") : errorText(err));
      setScan(false);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void checkIn(code);
  }

  function decoded(text: string) {
    setScan(false);
    setCode(text);
    void checkIn(text);
  }

  return (
    <Modal title={t("live.checkIn")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">{t("live.checkInHint")}</p>
        {error && <Alert>{error}</Alert>}
        {scan && <QrScanner onDecode={decoded} />}
        <Button type="button" variant="secondary" className="w-full" onClick={() => setScan(!scan)} disabled={busy}>
          {scan ? t("live.scan.stop") : t("live.scan.button")}
        </Button>
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="GC-XXXXXX" autoFocus={!scan} required className="font-mono uppercase" />
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {t("live.checkInStart")}
        </Button>
      </form>
    </Modal>
  );
}
