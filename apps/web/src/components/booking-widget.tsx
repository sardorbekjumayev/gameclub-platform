"use client";

import { formatMoney } from "@gc/types";
import { useRouter } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefundPolicy } from "@/components/refund-policy";
import { SeatMap } from "@/components/seat-map";
import { Alert, Button, Card, Input, Spinner, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { durationLabel, fmtDate, fmtTime, tzDate } from "@/lib/format";
import { session, useAuth } from "@/lib/session";
import type { Availability, BranchDetail, BranchPackage, Slots } from "@/lib/types";
import { idemKey, useApi, useSubmitKey } from "@/lib/use-api";

const DURATIONS = [60, 120, 180, 240, 300, 360] as const;
const MAX_DEVICES = 5;
const DRAFT_KEY = "gc.bookDraft";

/** Kirmagan foydalanuvchi tanlovi — login'dan qaytganda tiklanadi (qaytadan tanlash shart emas). */
type Draft = { branchId: string; date: string; hours: number; pkg: BranchPackage | null; start: string | null; picked: string[]; payMode: "ONLINE" | "AT_CLUB"; promo: string };

function takeDraft(branchId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (d.branchId !== branchId) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    // O'tib ketgan vaqt tiklanmaydi
    if (d.start && new Date(d.start).getTime() < Date.now()) return { ...d, start: null, picked: [] };
    return d;
  } catch {
    return null;
  }
}

/**
 * Bron vidjeti (docs/01-API.md §6.8): sana → davomiylik → vaqt (slots) → qurilma (availability) → bron.
 * Onlayn to'lovda bron `PENDING_PAYMENT` (hold) bo'ladi va to'lov sahifasiga o'tiladi.
 */
export function BookingWidget({ branch }: { branch: BranchDetail }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const { me } = useAuth();
  const days = Math.min(branch.booking_settings.max_advance_days || 7, 14);
  const dates = useMemo(() => Array.from({ length: days + 1 }, (_, i) => tzDate(i, branch.timezone)), [days, branch.timezone]);
  const [draft] = useState(() => takeDraft(branch.id));
  const [date, setDate] = useState(draft && dates.includes(draft.date) ? draft.date : dates[0]);
  const [hours, setHours] = useState<number>(draft?.hours ?? 120);
  /** Paket tanlansa davomiylik paketniki (qulflanadi), narx — paket narxi */
  const [pkg, setPkg] = useState<BranchPackage | null>(draft?.pkg ?? null);
  const duration = pkg?.duration_minutes ?? hours;
  const [start, setStart] = useState<string | null>(draft && dates.includes(draft.date) ? draft.start : null);
  const [picked, setPicked] = useState<string[]>(draft && dates.includes(draft.date) ? draft.picked : []);
  const [payModeRaw, setPayMode] = useState<"ONLINE" | "AT_CLUB">(draft?.payMode ?? "ONLINE");
  const cardTransfer = !!branch.payment_options?.card_transfer;
  const payModes = branch.payment_options?.pay_at_club === false ? (["ONLINE"] as const) : (["ONLINE", "AT_CLUB"] as const);
  // Klub "klubda to'lash"ni o'chirgan bo'lsa — faqat onlayn/karta
  const payMode = payModes.length === 1 ? "ONLINE" : payModeRaw;
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const submitKey = useSubmitKey();
  const [error, setError] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState(draft?.promo ?? "");
  const root = useRef<HTMLDivElement>(null);

  // Login'dan qaytganda — to'g'ridan-to'g'ri bron vidjetiga
  useEffect(() => {
    if (draft) root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft]);
  const [promo, setPromo] = useState<{ code: string; discount: number; total: number; amount: number } | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);

  const packages = useApi<BranchPackage[]>(`/branches/${branch.id}/packages`);
  const pkgQuery = pkg ? `&package_id=${pkg.id}` : "";
  const slots = useApi<Slots>(`/branches/${branch.id}/slots?date=${date}&duration=${duration}${pkgQuery}`);
  const avail = useApi<Availability>(start ? `/branches/${branch.id}/availability?start_at=${encodeURIComponent(start)}&duration=${duration}${pkgQuery}` : null);

  const holdMinutes = avail.data?.hold_minutes ?? branch.booking_settings.hold_minutes;

  // O'tib ketgan slotlar ko'rsatilmaydi (sahifa ochilgan vaqt bo'yicha)
  const futureSlots = (slots.data?.slots ?? []).filter((s) => new Date(s.start_at).getTime() >= openedAt);
  const devices = avail.data?.devices ?? [];
  const selected = devices.filter((d) => picked.includes(d.id));
  const total = selected.reduce((sum, d) => sum + (d.price_quote?.amount ?? 0), 0);
  // Paket bo'yicha tejash: oddiy narx (server hisobi) − paket narxi
  const saved = pkg ? selected.reduce((sum, d) => sum + Math.max(0, (d.price_quote?.regular_amount ?? 0) - (d.price_quote?.amount ?? 0)), 0) : 0;

  // Promo faqat server hisoblagan summa uchun amal qiladi; tanlov o'zgarsa qayta tekshirish kerak
  const promoOk = promo && promo.amount === total ? promo : null;

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    if (!me) {
      goLogin();
      return;
    }
    setPromoBusy(true);
    setPromoErr(null);
    try {
      const res = await session.post<{ valid: boolean; code: string; discount: number; total: number }>(
        "/promotions/validate",
        { code, branch_id: branch.id, amount: total, ...(start ? { start_at: start } : {}), ...(picked.length ? { device_ids: picked } : {}) },
        { "Idempotency-Key": idemKey() },
      );
      setPromo({ code: res.data.code, discount: Number(res.data.discount), total: Number(res.data.total), amount: total });
    } catch (e) {
      setPromo(null);
      setPromoErr(errorText(e));
    } finally {
      setPromoBusy(false);
    }
  }

  const goLogin = () => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ branchId: branch.id, date, hours, pkg, start, picked, payMode, promo: promoInput } satisfies Draft));
    } catch {
      /* storage yo'q — tanlov qayta qilinadi */
    }
    router.push(`/login?next=${encodeURIComponent(`/clubs/${branch.id}`)}&reason=book`);
  };

  /** Eng arzon bo'sh joy(lar) — xaritadan qidirmasdan bir bosishda. */
  const freeDevices = devices.filter((d) => d.status === "AVAILABLE" && !!d.price_quote).sort((a, b) => (a.price_quote?.amount ?? 0) - (b.price_quote?.amount ?? 0));
  const pickAny = () => setPicked(freeDevices.slice(0, Math.max(1, picked.length)).map((d) => d.id));

  const resetFrom = (level: "date" | "duration" | "start") => {
    if (level !== "start") setStart(null);
    setPicked([]);
    setError(null);
  };

  async function book() {
    if (!me) {
      goLogin();
      return;
    }
    // Ikki marta bosish: `busy` keyingi render'gacha yangilanmaydi — ref darhol to'sadi
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const body = {
      branch_id: branch.id,
      start_at: start,
      duration_minutes: duration,
      items: picked.map((device_id) => ({ device_id })),
      source: "WEB",
      payment_mode: payMode,
      ...(pkg ? { package_id: pkg.id } : {}),
      ...(promoOk ? { promo_code: promoOk.code } : {}),
    };
    try {
      const res = await session.post<{ id: string }>("/bookings", body, { "Idempotency-Key": submitKey(body) });
      router.push(`/bookings/${res.data.id}${payMode === "ONLINE" ? "?pay=1" : ""}`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(errorText(e));
      if (code === "BOOKING_SLOT_TAKEN") {
        setPicked([]);
        avail.reload();
        slots.reload();
      }
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <Card className="scroll-mt-24 space-y-5" ref={root} id="book">
      <div className="font-display text-xl font-bold">{t("book.title")}</div>

      <section className="space-y-2">
        <StepLabel n={1} done>{t("book.date")}</StepLabel>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {dates.map((d, i) => (
            <button
              key={d}
              onClick={() => {
                setDate(d);
                resetFrom("date");
              }}
              className={cx("h-14 min-w-[64px] shrink-0 rounded-xl px-2 text-center text-xs font-bold", d === date ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}
            >
              {i === 0 ? t("book.today") : i === 1 ? t("book.tomorrow") : fmtDate(`${d}T12:00:00+05:00`, t, branch.timezone)}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <StepLabel n={2} done>{t("book.duration")}</StepLabel>
        <div className="grid grid-cols-3 gap-2">
          {DURATIONS.map((m) => (
            <button
              key={m}
              onClick={() => {
                setHours(m);
                setPkg(null);
                resetFrom("duration");
              }}
              className={cx("h-10 rounded-xl text-sm font-bold", !pkg && m === hours ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}
            >
              {durationLabel(m, t)}
            </button>
          ))}
        </div>
        {!!packages.data?.length && (
          <div className="space-y-2 pt-1">
            <div className="text-[13px] font-semibold text-muted">{t("book.packages")}</div>
            {/* Telefonda gorizontal qator — vaqt tanlash pastga surilib ketmasin */}
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0">
              {packages.data.map((p) => {
                const on = pkg?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPkg(on ? null : p);
                      resetFrom("duration");
                    }}
                    className={cx("w-[250px] shrink-0 rounded-xl px-3 py-2.5 text-left sm:w-auto", on ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">
                        {p.name}
                        <span className={cx("ml-1.5 text-xs font-medium", on ? "text-on-accent/80" : "text-muted")}>{p.tariff.name}</span>
                      </span>
                      <span className="font-display text-base font-bold tabular-nums">{formatMoney(p.price, locale)}</span>
                    </span>
                    <span className={cx("mt-0.5 flex flex-wrap justify-between gap-x-2 text-xs", on ? "text-on-accent/80" : "text-muted")}>
                      <span>
                        {durationLabel(p.duration_minutes, t)}
                        {p.start_time && p.end_time ? ` · ${t("book.packageWindow", { from: p.start_time, to: p.end_time })}` : ""}
                      </span>
                      {p.regular_amount > p.price && <span className={cx("font-semibold", !on && "text-accent")}>{t("book.packageSave", { amount: formatMoney(p.regular_amount - p.price, locale) })}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <StepLabel n={3} done={!!start}>{t("book.time")}</StepLabel>
        {slots.loading ? (
          <Spinner className="mx-auto h-5 w-5" />
        ) : slots.error ? (
          <Alert>{slots.error}</Alert>
        ) : futureSlots.length === 0 ? (
          <div className="text-sm text-muted">{t("book.noSlots")}</div>
        ) : (
          <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto pr-1">
            {futureSlots.map((s) => (
              <button
                key={s.start_at}
                disabled={s.available_count === 0}
                onClick={() => {
                  setStart(s.start_at);
                  resetFrom("start");
                }}
                className={cx(
                  "h-10 rounded-xl text-sm font-bold tabular-nums disabled:cursor-not-allowed disabled:opacity-30",
                  s.start_at === start ? "bg-accent text-on-accent" : "border border-line bg-surface-2",
                )}
                title={t("book.freeN", { n: s.available_count })}
              >
                {fmtTime(s.start_at, branch.timezone)}
              </button>
            ))}
          </div>
        )}
      </section>

      {start && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <StepLabel n={4} done={picked.length > 0}>{t("seat.title")}</StepLabel>
            <div className={cx("text-xs tabular-nums", picked.length ? "font-bold text-accent" : "text-muted")}>{t("seat.pickedOf", { n: picked.length, max: MAX_DEVICES })}</div>
          </div>
          {!avail.loading && freeDevices.length > 0 && picked.length === 0 && (
            <button
              type="button"
              onClick={pickAny}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-accent/50 bg-accent/10 text-sm font-bold text-accent transition hover:bg-accent/20"
            >
              <Sparkles className="h-4 w-4" />
              {t("book.pickAny")}
            </button>
          )}
          {avail.loading ? (
            <Spinner className="mx-auto h-5 w-5" />
          ) : avail.error ? (
            <Alert>{avail.error}</Alert>
          ) : (
            <SeatMap
              rooms={avail.data?.rooms ?? []}
              devices={devices}
              picked={picked}
              max={MAX_DEVICES}
              onToggle={(id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < MAX_DEVICES ? [...picked, id] : picked)}
              onPickGroup={(ids) => setPicked(ids.slice(0, MAX_DEVICES))}
            />
          )}
        </section>
      )}

      {picked.length > 0 && start && (
        <section className="space-y-3 border-t border-line-soft pt-4">
          <div className="text-sm text-muted">
            {fmtDate(start, t, branch.timezone)}, {fmtTime(start, branch.timezone)}–{fmtTime(new Date(new Date(start).getTime() + duration * 60_000).toISOString(), branch.timezone)} ·{" "}
            {selected.map((d) => d.name).join(", ")}
          </div>
          <div className={cx("grid gap-2", payModes.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {payModes.map((m) => (
              <button key={m} onClick={() => setPayMode(m)} className={cx("h-11 rounded-xl text-sm font-bold", payMode === m ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}>
                {m === "ONLINE" && cardTransfer ? t("book.pay.CARD") : t(`book.pay.${m}`)}
              </button>
            ))}
          </div>
          {payMode === "ONLINE" && <p className="text-xs text-muted">{cardTransfer ? t("book.cardHint", { n: holdMinutes }) : t("book.holdHint", { n: holdMinutes })}</p>}
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input
                value={promoInput}
                onChange={(e) => {
                  setPromoInput(e.target.value);
                  setPromo(null);
                  setPromoErr(null);
                }}
                placeholder={t("book.promo.placeholder")}
                maxLength={40}
                className="flex-1"
              />
              <Button variant="secondary" loading={promoBusy} disabled={!promoInput.trim()} onClick={applyPromo}>
                {t("book.promo.apply")}
              </Button>
            </div>
            {promoErr && <p className="text-xs text-danger-soft">{promoErr}</p>}
            {promo && !promoOk && <p className="text-xs text-muted">{t("book.promo.recheck")}</p>}
            {promoOk && <p className="text-xs text-accent">{t("book.promo.applied", { code: promoOk.code, amount: formatMoney(promoOk.discount, locale) })}</p>}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted">{t("book.total")}</span>
            <span className="text-right">
              {promoOk && <span className="mr-2 text-sm text-muted line-through tabular-nums">{formatMoney(total, locale)}</span>}
              <span className="font-display text-2xl font-bold text-accent tabular-nums">{formatMoney(promoOk ? promoOk.total : total, locale)}</span>
            </span>
          </div>
          {pkg && saved > 0 && <p className="text-right text-xs font-semibold text-accent">{t("book.packageSaved", { name: pkg.name, amount: formatMoney(saved, locale) })}</p>}
          <RefundPolicy policy={branch.cancellation_policy} />
          {error && <Alert>{error}</Alert>}
          <Button size="lg" className="w-full" loading={busy} onClick={book}>
            {me ? (payMode === "ONLINE" ? t("book.bookAndPay") : t("book.book")) : t("book.loginToBook")}
          </Button>
        </section>
      )}
    </Card>
  );
}

/** Qadam sarlavhasi: raqam (yoki bajarilgan bo'lsa belgi) + nom. */
function StepLabel({ n, done, children }: { n: number; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
      <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold", done ? "bg-accent text-on-accent" : "border border-line text-muted")}>
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
      </span>
      {children}
    </div>
  );
}
