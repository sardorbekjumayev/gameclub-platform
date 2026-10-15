"use client";

import { formatMoney } from "@gc/types";
import { useState } from "react";
import { Alert, Button, Field, Input, Select, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { LiveDevice, TariffPackage } from "@/lib/types";
import { idemKey, normalizePhone, useApi } from "@/lib/use-api";
import { fmtClock, fmtTime } from "./time";

type Pay = "CASH" | "TERMINAL" | "LATER";
/** Muvaffaqiyat matni — statik yoki API javobidan (masalan VIP yakunidagi summa). */
export type Success = string | ((data: unknown) => string);
type Run = (name: string, fn: () => Promise<unknown>, success?: Success) => Promise<void>;
/** VIP (ochiq vaqt) — davomiylik tanlovidagi alohida variant. */
const OPEN = "OPEN" as const;
const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 360] as const;

/** Xato kodi SHIFT_REQUIRED bo'lsa — kassa smenasini ochishga yo'naltirish. */
export const isShiftRequired = (e: unknown) => (e as { details?: { reason?: string } })?.details?.reason === "SHIFT_REQUIRED";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[20px] bg-bg p-5 shadow-2xl sm:rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button className="rounded-lg px-2 text-2xl leading-none text-muted hover:text-fg" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PayPicker({ value, onChange, allowLater = true }: { value: Pay; onChange: (p: Pay) => void; allowLater?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["CASH", "TERMINAL", ...(allowLater ? ["LATER"] : [])] as Pay[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cx("h-11 rounded-xl text-sm font-bold", value === p ? "bg-accent text-on-accent" : "border border-line bg-surface text-fg")}
        >
          {t(`pay.${p}` as never)}
        </button>
      ))}
    </div>
  );
}

/** Qurilma kartasi bosilganda: holatiga qarab amallar (walk-in / sessiya boshqaruvi / check-in). */
export function DevicePanel({
  device,
  branchId,
  freeDevices,
  now,
  onDone,
  onClose,
  onShiftRequired,
}: {
  device: LiveDevice;
  branchId: string;
  freeDevices: LiveDevice[];
  now: number;
  onDone: (msg?: string) => void;
  onClose: () => void;
  onShiftRequired: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<unknown>, success?: Success) {
    setBusy(name);
    setError(null);
    try {
      const r = await fn();
      onDone(typeof success === "function" ? success((r as { data?: unknown })?.data) : success);
    } catch (e) {
      if (isShiftRequired(e)) onShiftRequired();
      else setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const title = `${device.name}${device.category ? ` · ${device.category.name}` : ""}`;

  return (
    <Modal title={title} onClose={onClose}>
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {device.occupancy === "OCCUPIED" && device.session ? (
        device.session.is_open ? (
          <OpenSessionActions device={device} freeDevices={freeDevices} now={now} busy={busy} run={run} />
        ) : (
          <SessionActions device={device} freeDevices={freeDevices} now={now} busy={busy} run={run} />
        )
      ) : device.occupancy === "UNAVAILABLE" ? (
        <Alert tone="info">{t("live.unavailableInfo", { status: t(`status.${device.operational_status}` as never) })}</Alert>
      ) : (
        <div className="space-y-5">
          {device.next_booking && (
            <div className="space-y-3 rounded-xl bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-bold">{device.next_booking.customer_name ?? t("live.guest")}</span>
                <span className="font-mono text-xs">{device.next_booking.code}</span>
              </div>
              <div className="text-sm text-muted">
                {fmtTime(device.next_booking.start_at)}–{fmtTime(device.next_booking.end_at)} · {t(`bookingStatus.${device.next_booking.status}` as never)}
              </div>
              {["CONFIRMED", "CHECKED_IN"].includes(device.next_booking.status) && (
                <Button
                  className="w-full"
                  loading={busy === "checkin"}
                  onClick={() =>
                    run(
                      "checkin",
                      () => session.post(`/bookings/${device.next_booking!.id}/check-in`, { start_session: true, force: true }, { "Idempotency-Key": idemKey() }),
                      t("live.sessionStarted"),
                    )
                  }
                >
                  {t("live.checkInStart")}
                </Button>
              )}
            </div>
          )}
          <WalkInForm branchId={branchId} deviceIds={[device.id]} nextBookingAt={device.next_booking?.start_at ?? null} busy={busy === "walkin"} run={run} />
        </div>
      )}
    </Modal>
  );
}

export function WalkInForm({
  branchId,
  deviceIds,
  nextBookingAt = null,
  busy,
  run,
}: {
  branchId: string;
  deviceIds: string[];
  /** Shu qurilmadagi keyingi bron — VIP shu vaqtgacha davom eta oladi */
  nextBookingAt?: string | null;
  busy: boolean;
  run: Run;
}) {
  const { t, locale } = useI18n();
  const packages = useApi<TariffPackage[]>(`/branches/${branchId}/packages`);
  const [duration, setDuration] = useState<number | typeof OPEN>(60);
  /** Paket tanlansa davomiylik va narx paketdan (API qurilmaga mosligini tekshiradi) */
  const [packageId, setPackageId] = useState<string | null>(null);
  const open = duration === OPEN && !packageId;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pay, setPay] = useState<Pay>("CASH");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          "walkin",
          () =>
            session.post(
              "/bookings/walk-in",
              {
                branch_id: branchId,
                device_ids: deviceIds,
                ...(open
                  ? { open: true, payment_method: "LATER" }
                  : packageId
                    ? { package_id: packageId, payment_method: pay }
                    : { duration_minutes: duration, payment_method: pay }),
                ...(name.trim() && { guest_name: name.trim() }),
                ...(phone.trim() && { guest_phone: normalizePhone(phone) }),
              },
              { "Idempotency-Key": idemKey() },
            ),
          open ? t("live.vip.started") : t("live.sessionStarted"),
        );
      }}
    >
      <div className="text-sm font-bold">{t("live.walkIn")}</div>
      <button
        type="button"
        onClick={() => {
          setDuration(OPEN);
          setPackageId(null);
        }}
        className={cx("flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left", open ? "bg-accent text-on-accent" : "border border-line bg-surface")}
      >
        <span>
          <span className="block font-bold">{t("live.vip.title")}</span>
          <span className={cx("block text-xs", open ? "text-on-accent/80" : "text-muted")}>{t("live.vip.hint")}</span>
        </span>
        <span className="font-display text-xl font-bold">∞</span>
      </button>
      <div className="grid grid-cols-4 gap-2">
        {DURATIONS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setDuration(m);
              setPackageId(null);
            }}
            className={cx("h-10 rounded-xl text-sm font-bold", duration === m && !packageId ? "bg-accent text-on-accent" : "border border-line bg-surface")}
          >
            {m < 60 ? t("live.minN", { n: m }) : t("quote.hoursN", { n: m / 60 })}
          </button>
        ))}
      </div>
      {!!packages.data?.length && (
        <div className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted">{t("live.packages")}</div>
          <div className="grid grid-cols-2 gap-2">
            {packages.data.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPackageId(p.id)}
                className={cx("rounded-xl px-3 py-2 text-left", packageId === p.id ? "bg-accent text-on-accent" : "border border-line bg-surface")}
              >
                <span className="block text-sm font-bold">{p.name}</span>
                {p.tariff && <span className={cx("block truncate text-xs", packageId === p.id ? "text-on-accent/80" : "text-muted")}>{p.tariff.name}</span>}
                <span className={cx("block text-xs tabular-nums", packageId === p.id ? "text-on-accent/80" : "text-muted")}>{formatMoney(p.price, locale)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("live.guestName")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t("live.guestPhone")}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998" />
        </Field>
      </div>
      {open ? (
        <>
          <Alert tone="info">{t("live.vip.payLater")}</Alert>
          {nextBookingAt && <Alert>{t("live.vip.limitWarn", { time: fmtTime(nextBookingAt) })}</Alert>}
        </>
      ) : (
        <Field label={t("live.payment")}>
          <PayPicker value={pay} onChange={setPay} />
        </Field>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {open ? t("live.vip.start") : t("live.startSession")}
      </Button>
    </form>
  );
}

function SessionActions({
  device,
  freeDevices,
  now,
  busy,
  run,
}: {
  device: LiveDevice;
  freeDevices: LiveDevice[];
  now: number;
  busy: string | null;
  run: Run;
}) {
  const { t, locale } = useI18n();
  const s = device.session!;
  const [extend, setExtend] = useState(60);
  const [extPay, setExtPay] = useState<Pay>("CASH");
  const [moveTo, setMoveTo] = useState(freeDevices[0]?.id ?? "");
  const [payMethod, setPayMethod] = useState<Pay>("CASH");
  const [waive, setWaive] = useState(false);
  const remaining = remainingNow(device, now);
  const key = () => ({ "Idempotency-Key": idemKey() });

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">{s.customer_name ?? t("live.guest")}</span>
          {s.booking_code && <span className="font-mono text-xs text-muted">{s.booking_code}</span>}
        </div>
        <div className={cx("mt-1 font-display text-4xl font-bold tabular-nums", remaining !== null && remaining < 0 ? "text-danger-soft" : remaining !== null && remaining < 600 ? "text-warn" : "")}>
          {remaining === null ? "—" : fmtClock(remaining)}
        </div>
        <div className="mt-1 text-xs text-muted">
          {t("live.startedAt", { time: fmtTime(s.started_at) })}
          {s.expected_end_at && ` · ${t("live.endsAt", { time: fmtTime(s.expected_end_at) })}`}
          {s.status === "PAUSED" && ` · ${t("status.PAUSED")}`}
        </div>
        {s.amount_due > 0 && <div className="mt-2 text-sm font-bold text-warn">{t("live.amountDue", { amount: formatMoney(s.amount_due, locale) })}</div>}
      </div>

      {s.amount_due > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-bold">{t("live.takePayment")}</div>
          <PayPicker value={payMethod} onChange={setPayMethod} allowLater={false} />
          <Button
            className="w-full"
            loading={busy === "pay"}
            onClick={() => run("pay", () => session.post("/payments/cash", { booking_id: s.booking_id, method: payMethod }, key()), t("live.paid"))}
          >
            {t("live.acceptAmount", { amount: formatMoney(s.amount_due, locale) })}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-bold">{t("live.extend")}</div>
        <div className="grid grid-cols-4 gap-2">
          {[30, 60, 120, 180].map((m) => (
            <button key={m} type="button" onClick={() => setExtend(m)} className={cx("h-10 rounded-xl text-sm font-bold", extend === m ? "bg-accent text-on-accent" : "border border-line bg-surface")}>
              +{m < 60 ? t("live.minN", { n: m }) : t("quote.hoursN", { n: m / 60 })}
            </button>
          ))}
        </div>
        <PayPicker value={extPay} onChange={setExtPay} />
        <Button
          variant="secondary"
          className="w-full"
          loading={busy === "extend"}
          onClick={() => run("extend", () => session.post(`/sessions/${s.id}/extend`, { minutes: extend, payment_method: extPay }, key()), t("live.extended"))}
        >
          {t("live.extendBy", { n: extend })}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {s.status === "PAUSED" ? (
          <Button variant="secondary" loading={busy === "resume"} onClick={() => run("resume", () => session.post(`/sessions/${s.id}/resume`, {}, key()))}>
            {t("live.resume")}
          </Button>
        ) : (
          <Button variant="secondary" loading={busy === "pause"} onClick={() => run("pause", () => session.post(`/sessions/${s.id}/pause`, {}, key()))}>
            {t("live.pause")}
          </Button>
        )}
        <div className="flex gap-2">
          <Select className="h-11 min-w-0 flex-1 text-sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} disabled={freeDevices.length === 0}>
            {freeDevices.length === 0 && <option value="">{t("live.noFree")}</option>}
            {freeDevices.map((d) => (
              <option key={d.id} value={d.id}>
                → {d.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!moveTo} loading={busy === "move"} onClick={() => run("move", () => session.post(`/sessions/${s.id}/move`, { to_device_id: moveTo }, key()), t("live.moved"))}>
            {t("live.move")}
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t border-line-soft pt-4">
        {remaining !== null && remaining < -300 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
            {t("live.waiveOvertime")}
          </label>
        )}
        <Button
          variant="danger"
          className="w-full"
          loading={busy === "stop"}
          onClick={() => confirm(t("live.confirmStop", { name: device.name })) && run("stop", () => session.post(`/sessions/${s.id}/stop`, { waive_overtime: waive }, key()), t("live.stopped"))}
        >
          {t("live.stop")}
        </Button>
      </div>
    </div>
  );
}

/** VIP (ochiq vaqt): taymer oldinga sanaydi, summa server hisobi (snapshot), yakunda to'lov. */
function OpenSessionActions({ device, freeDevices, now, busy, run }: { device: LiveDevice; freeDevices: LiveDevice[]; now: number; busy: string | null; run: Run }) {
  const { t, locale } = useI18n();
  const s = device.session!;
  const [moveTo, setMoveTo] = useState(freeDevices[0]?.id ?? "");
  const [pay, setPay] = useState<Pay>("CASH");
  const elapsed = elapsedNow(device, now) ?? 0;
  const limitLeft = s.must_end_by ? Math.round((new Date(s.must_end_by).getTime() - now) / 1000) : null;
  const key = () => ({ "Idempotency-Key": idemKey() });
  const accrued = s.accrued_amount ?? 0;

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-surface-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold">{s.customer_name ?? t("live.guest")}</span>
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent">VIP</span>
        </div>
        <div className="mt-1 font-display text-4xl font-bold tabular-nums">{fmtClock(elapsed)}</div>
        <div className="mt-1 text-xs text-muted">
          {t("live.startedAt", { time: fmtTime(s.started_at) })}
          {s.status === "PAUSED" && ` · ${t("status.PAUSED")}`}
        </div>
        <div className="mt-2 text-lg font-bold text-accent">{t("live.vip.accrued", { amount: formatMoney(accrued, locale) })}</div>
        {limitLeft !== null && (
          <div className={cx("mt-2 text-sm font-bold", limitLeft < 15 * 60 ? "text-danger-soft" : "text-warn")}>
            {t("live.vip.limit", { time: fmtTime(s.must_end_by!) })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {s.status === "PAUSED" ? (
          <Button variant="secondary" loading={busy === "resume"} onClick={() => run("resume", () => session.post(`/sessions/${s.id}/resume`, {}, key()))}>
            {t("live.resume")}
          </Button>
        ) : (
          <Button variant="secondary" loading={busy === "pause"} onClick={() => run("pause", () => session.post(`/sessions/${s.id}/pause`, {}, key()))}>
            {t("live.pause")}
          </Button>
        )}
        <div className="flex gap-2">
          <Select className="h-11 min-w-0 flex-1 text-sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} disabled={freeDevices.length === 0}>
            {freeDevices.length === 0 && <option value="">{t("live.noFree")}</option>}
            {freeDevices.map((d) => (
              <option key={d.id} value={d.id}>
                → {d.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!moveTo} loading={busy === "move"} onClick={() => run("move", () => session.post(`/sessions/${s.id}/move`, { to_device_id: moveTo }, key()), t("live.moved"))}>
            {t("live.move")}
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t border-line-soft pt-4">
        <div className="text-sm font-bold">{t("live.vip.finish")}</div>
        <PayPicker value={pay} onChange={setPay} />
        <Button
          variant="danger"
          className="w-full"
          loading={busy === "stop"}
          onClick={() =>
            confirm(t("live.vip.confirmStop", { name: device.name })) &&
            run(
              "stop",
              () => session.post(`/sessions/${s.id}/stop`, { payment_method: pay }, key()),
              (data) => {
                const r = data as { open_minutes?: number; open_amount?: number };
                return t("live.vip.stopped", { minutes: r.open_minutes ?? 0, amount: formatMoney(r.open_amount ?? 0, locale) });
              },
            )
          }
        >
          {t("live.vip.stop")}
        </Button>
        <p className="text-xs text-muted">{t("live.vip.finalHint")}</p>
      </div>
    </div>
  );
}

/** VIP: boshlangandan beri o'ynalgan soniyalar (pauzalar chiqarilgan, pauzada to'xtaydi). */
export function elapsedNow(d: LiveDevice, now: number) {
  const s = d.session;
  if (!s?.is_open) return null;
  const until = s.status === "PAUSED" && s.paused_at ? new Date(s.paused_at).getTime() : now;
  return Math.max(0, Math.round((until - new Date(s.started_at).getTime()) / 1000) - (s.total_paused_seconds ?? 0));
}

/** Snapshot olingandan beri o'tgan vaqtni hisobga olgan qolgan soniyalar (pauzada to'xtaydi). */
export function remainingNow(d: LiveDevice, now: number) {
  const s = d.session;
  if (!s?.expected_end_at) return null;
  if (s.status === "PAUSED") return s.remaining_seconds;
  return Math.round((new Date(s.expected_end_at).getTime() - now) / 1000);
}
