"use client";

import { formatMoney } from "@gc/types";
import { CheckCircle2, Clock, Gamepad2, Info, MapPin, Minus, Phone, Plus, ShieldCheck, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { RentalPrices, RentalThumb } from "@/components/rental-card";
import { Alert, Badge, Button, Card, Chip, Input, Spinner, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime, tzDate } from "@/lib/format";
import { session, useAuth } from "@/lib/session";
import type { RentalItem, RentalQuote } from "@/lib/types";
import { useApi, useSubmitKey } from "@/lib/use-api";

export default function RentalItemPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const item = useApi<RentalItem>(`/rental-items/${id}`);

  if (item.loading) return <Spinner className="mx-auto my-24 h-6 w-6" />;
  if (item.error || !item.data)
    return (
      <main className="mx-auto max-w-xl flex-1 px-4 py-16">
        <Alert>{item.error ?? t("rent.notFound")}</Alert>
      </main>
    );
  const it = item.data;
  const b = it.branch;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
      <Link href="/rentals" className="text-sm text-muted hover:text-fg">
        ← {t("rent.kicker")}
      </Link>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <section className="overflow-hidden rounded-3xl border border-line-soft bg-surface">
            <div className="relative aspect-[16/8]">
              <RentalThumb item={it} />
            </div>
            <div className="space-y-4 p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="violet">{t(`rentalType.${it.type}` as MessageKey)}</Badge>
                <Badge tone={it.available_now > 0 ? "green" : "red"}>{it.available_now > 0 ? t("rent.availableN", { n: it.available_now }) : t("rent.busyNow")}</Badge>
                {it.delivery_available && <Badge>{t("rent.deliveryAvailable")}</Badge>}
              </div>
              <h1 className="font-display text-[28px] font-bold leading-tight sm:text-4xl">{it.name}</h1>
              <RentalPrices item={it} className="flex flex-wrap items-baseline text-base" />
              {it.description && <p className="whitespace-pre-line text-muted">{it.description}</p>}
            </div>
          </section>

          {(it.includes.length > 0 || it.games.length > 0) && (
            <Card className="space-y-4">
              {it.includes.length > 0 && (
                <div className="space-y-2">
                  <h2 className="font-display text-lg font-bold">{t("rent.includes")}</h2>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {it.includes.map((x) => (
                      <li key={x} className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {it.games.length > 0 && (
                <div className="space-y-2">
                  <h2 className="font-display text-lg font-bold">{t("rent.games")}</h2>
                  <div className="flex flex-wrap gap-2">
                    {it.games.map((g) => (
                      <span key={g} className="rounded-full border border-line px-3 py-1 text-sm">
                        {g}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card className="space-y-3">
            <h2 className="font-display text-lg font-bold">{t("rent.terms")}</h2>
            <ul className="space-y-2 text-sm">
              {it.price_per_hour != null && (
                <li className="flex gap-2">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {t("rent.minHours", { n: it.min_hours })}
                </li>
              )}
              <li className="flex gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {t("rent.maxDays", { n: it.max_days })}
              </li>
              {it.deposit_amount > 0 && (
                <li className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {t("rent.depositNote", {
                    amount: formatMoney(it.deposit_amount),
                  })}
                </li>
              )}
              {it.requirements && (
                <li className="flex gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {it.requirements}
                </li>
              )}
              <li className="flex gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {t("rent.payNote")}
              </li>
            </ul>
          </Card>

          <Card className="space-y-3">
            <h2 className="font-display text-lg font-bold">{t("rent.whereFrom")}</h2>
            <Link href={`/clubs/${b.id}`} className="flex items-center gap-3 rounded-xl bg-surface-2 p-3 transition hover:bg-surface-3">
              {b.club.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.club.logo_url} alt="" className="h-12 w-12 rounded-xl object-cover" />
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent font-display text-xl font-bold text-on-accent">{b.club.name.slice(0, 1)}</span>
              )}
              <div className="min-w-0">
                <div className="font-bold">{b.club.name}</div>
                <div className="flex items-center gap-1 text-sm text-muted">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {b.name} · {b.address}
                  </span>
                </div>
              </div>
              {b.is_open != null && (
                <span className="ml-auto">
                  <Badge tone={b.is_open ? "green" : "red"}>{b.is_open ? t("clubs.open") : t("clubs.closed")}</Badge>
                </span>
              )}
            </Link>
            {(b.phone ?? b.club.phone) && (
              <a href={`tel:${b.phone ?? b.club.phone}`} className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">
                <Phone className="h-4 w-4" />
                {b.phone ?? b.club.phone}
              </a>
            )}
          </Card>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <RentForm item={it} />
        </div>
      </div>
    </main>
  );
}

const HOUR_PRESETS = [2, 3, 4, 6, 8, 12];
const DAY_PRESETS = [1, 2, 3, 5, 7];
/** Sana chiplari uchun kun o'rtasi (Asia/Tashkent — doimiy UTC+05:00). */
const NOON = "T12:00:00+05:00";

type RentalSlots = {
  date: string;
  timezone: string;
  slots: { start_at: string; end_at: string; available_units: number }[];
};

function RentForm({ item }: { item: RentalItem }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const { me } = useAuth();
  const tz = item.branch.timezone;
  const hasHour = item.price_per_hour != null;
  const hasDay = item.price_per_day != null;
  const [unit, setUnit] = useState<"HOUR" | "DAY">(hasHour ? "HOUR" : "DAY");
  const [units, setUnits] = useState(hasHour ? Math.max(item.min_hours, 2) : 1);
  const dates = useMemo(() => Array.from({ length: 14 }, (_, i) => tzDate(i, tz)), [tz]);
  const [pickedDate, setDate] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [startRaw, setStart] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const submitKey = useSubmitKey();
  const [error, setError] = useState<string | null>(null);

  const maxUnits = unit === "HOUR" ? Math.min(item.max_days * 24, 72) : item.max_days;
  const minUnits = unit === "HOUR" ? item.min_hours : 1;
  // Server faqat ish vaqti va bo'sh dona bo'yicha mumkin bo'lgan vaqtlarni qaytaradi
  // Bugun vaqt qolmagan bo'lsa (kech kirilgan) — foydalanuvchi sana tanlamaguncha ertangi kun ko'rsatiladi
  const slotQs = (d: string) => `/rental-items/${item.id}/slots?${new URLSearchParams({ date: d, rate_unit: unit, units: String(units), quantity: String(qty) })}`;
  const today = useApi<RentalSlots>(pickedDate ? null : slotQs(dates[0]));
  const date = pickedDate ?? (today.data && today.data.slots.length === 0 ? dates[1] : dates[0]);
  const slots = useApi<RentalSlots>(slotQs(date));
  const slotList = slots.data?.date === date ? slots.data.slots : [];
  const start = startRaw && slotList.some((x) => x.start_at === startRaw) ? startRaw : null;
  const qs = start
    ? new URLSearchParams({
        rate_unit: unit,
        units: String(units),
        start_at: start,
        quantity: String(qty),
        fulfillment,
      })
    : null;
  const quote = useApi<RentalQuote>(qs ? `/rental-items/${item.id}/quote?${qs}` : null);
  const q = quote.data;
  const money = (n: number) => formatMoney(n, locale);

  const switchUnit = (u: "HOUR" | "DAY") => {
    setUnit(u);
    setUnits(u === "HOUR" ? Math.max(item.min_hours, 2) : 1);
  };

  async function submit() {
    if (!me) {
      router.push(`/login?next=${encodeURIComponent(`/rentals/${item.id}`)}`);
      return;
    }
    if (!start) return;
    // Ikki marta bosish: `busy` keyingi render'gacha yangilanmaydi — ref darhol to'sadi
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const body = {
      item_id: item.id,
      rate_unit: unit,
      units,
      start_at: start,
      quantity: qty,
      fulfillment,
      ...(fulfillment === "DELIVERY" ? { delivery_address: address.trim() } : {}),
      ...(phone.trim() ? { contact_phone: normalizePhone(phone) } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    try {
      const res = await session.post<{ id: string }>("/rentals", body, { "Idempotency-Key": submitKey(body) });
      router.push(`/my-rentals/${res.data.id}`);
    } catch (e) {
      setError(errorText(e));
      quote.reload();
      slots.reload();
      setBusy(false);
      submitting.current = false;
    }
  }

  const presets = (unit === "HOUR" ? HOUR_PRESETS : DAY_PRESETS).filter((n) => n >= minUnits && n <= maxUnits);

  return (
    <Card className="space-y-5">
      <div className="font-display text-xl font-bold">{t("rent.form.title")}</div>

      {hasHour && hasDay && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-1">
          {(["HOUR", "DAY"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => switchUnit(u)}
              className={cx("h-10 rounded-xl text-sm font-bold transition", unit === u ? "bg-accent text-on-accent" : "text-muted hover:text-fg")}
            >
              {t(u === "HOUR" ? "rent.hourly" : "rent.daily")}
            </button>
          ))}
        </div>
      )}

      <section className="space-y-2">
        <div className="text-[13px] font-semibold text-muted">{t(unit === "HOUR" ? "rent.form.howManyHours" : "rent.form.howManyDays")}</div>
        <div className="flex items-center gap-3">
          <Stepper
            value={units}
            min={minUnits}
            max={maxUnits}
            onChange={setUnits}
            label={t(unit === "HOUR" ? "rent.hoursN" : "rent.daysN", {
              n: units,
            })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((n) => (
            <Chip key={n} active={units === n} onClick={() => setUnits(n)}>
              {t(unit === "HOUR" ? "rent.hoursN" : "rent.daysN", { n })}
            </Chip>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-[13px] font-semibold text-muted">{t(fulfillment === "DELIVERY" ? "rent.form.deliveryWhen" : "rent.form.pickupWhen")}</div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {dates.map((d, i) => (
            <Chip key={d} active={date === d} onClick={() => setDate(d)} className="shrink-0">
              {i === 0 ? t("rent.today") : i === 1 ? t("rent.tomorrow") : fmtDate(`${d}${NOON}`, t, tz)}
            </Chip>
          ))}
        </div>
        {slots.loading && <Spinner className="mx-auto my-3 h-5 w-5" />}
        {slots.error && <div className="text-sm text-danger-soft">{slots.error}</div>}
        {!slots.loading && !slots.error && slotList.length === 0 && <p className="text-sm text-muted">{t("rent.form.noTimes")}</p>}
        {!slots.loading && slotList.length > 0 && (
          <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto pr-1" role="listbox" aria-label={t("rent.form.time")}>
            {slotList.map((x) => (
              <button
                key={x.start_at}
                type="button"
                onClick={() => setStart(x.start_at)}
                className={cx(
                  "h-10 rounded-xl text-sm font-bold tabular-nums transition",
                  start === x.start_at ? "bg-accent text-on-accent" : "border border-line bg-surface hover:border-accent/50",
                )}
              >
                {fmtTime(x.start_at, tz)}
              </button>
            ))}
          </div>
        )}
      </section>

      {item.quantity > 1 && (
        <section className="space-y-2">
          <div className="text-[13px] font-semibold text-muted">{t("rent.form.quantity")}</div>
          <Stepper value={qty} min={1} max={Math.min(item.quantity, 10)} onChange={setQty} label={t("rent.pcsN", { n: qty })} />
        </section>
      )}

      <section className="space-y-2">
        <div className="text-[13px] font-semibold text-muted">{t("rent.form.how")}</div>
        <div className={cx("grid gap-2", item.delivery_available && "grid-cols-2")}>
          <OptionTile
            active={fulfillment === "PICKUP"}
            onClick={() => setFulfillment("PICKUP")}
            icon={<Store className="h-5 w-5" />}
            title={t("rent.pickup")}
            sub={t("rent.free")}
          />
          {item.delivery_available && (
            <OptionTile
              active={fulfillment === "DELIVERY"}
              onClick={() => setFulfillment("DELIVERY")}
              icon={<Truck className="h-5 w-5" />}
              title={t("rent.delivery")}
              sub={item.delivery_fee ? `+${money(item.delivery_fee)}` : t("rent.free")}
            />
          )}
        </div>
        {fulfillment === "DELIVERY" && <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("rent.form.address")} maxLength={300} />}
      </section>

      <section className="grid gap-2">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" inputMode="tel" aria-label={t("rent.form.phone")} />
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("rent.form.notes")} maxLength={500} />
      </section>

      {!start && slotList.length > 0 && <p className="text-center text-sm text-muted">{t("rent.form.pickTime")}</p>}
      {start && (
        <section className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm">
          {quote.loading && <Spinner className="mx-auto h-5 w-5" />}
          {quote.error && <div className="text-danger-soft">{quote.error}</div>}
          {q && !quote.loading && (
            <>
              <Row label={`${money(q.unit_price)} × ${t(unit === "HOUR" ? "rent.hoursN" : "rent.daysN", { n: units })}${qty > 1 ? ` × ${qty}` : ""}`} value={money(q.subtotal)} />
              {q.delivery_fee > 0 && <Row label={t("rent.delivery")} value={money(q.delivery_fee)} />}
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <span className="font-bold">{t("rent.total")}</span>
                <span className="font-display text-2xl font-bold text-accent tabular-nums">{money(q.total)}</span>
              </div>
              {q.deposit > 0 && <Row label={t("rent.depositReturnable")} value={money(q.deposit)} muted />}
              <div className="text-xs text-muted">
                {t("rent.returnAt", {
                  when: `${fmtDate(q.end_at, t, tz)}, ${fmtTime(q.end_at, tz)}`,
                })}
              </div>
              {!q.is_available && <div className="font-semibold text-danger-soft">{t("rent.notEnough", { n: q.available_units })}</div>}
            </>
          )}
        </section>
      )}

      {error && <Alert>{error}</Alert>}
      <Button size="lg" className="w-full" loading={busy} disabled={!start || !q?.is_available || (fulfillment === "DELIVERY" && address.trim().length < 5)} onClick={submit}>
        <Gamepad2 className="h-5 w-5" />
        {me ? t("rent.form.submit") : t("rent.form.loginToRent")}
      </Button>
      <p className="text-center text-xs text-muted">{t("rent.form.confirmNote")}</p>
    </Card>
  );
}

const normalizePhone = (v: string) => {
  const digits = v.replace(/\D/g, "");
  return digits.length === 9 ? `+998${digits}` : `+${digits}`;
};

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl border border-line bg-surface p-1">
      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="−"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-[96px] text-center font-display text-lg font-bold tabular-nums">{label}</span>
      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="+"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function OptionTile({ active, onClick, icon, title, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("flex items-center gap-3 rounded-2xl border p-3 text-left transition", active ? "border-accent bg-accent/10" : "border-line bg-surface hover:border-muted/60")}
    >
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl", active ? "bg-accent text-on-accent" : "bg-surface-2 text-muted")}>{icon}</span>
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
    </button>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-3", muted && "text-muted")}>
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
