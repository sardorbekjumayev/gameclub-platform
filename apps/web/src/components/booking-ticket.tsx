"use client";

import { formatMoney } from "@gc/types";
import { CalendarDays, Clock, Hourglass, MapPin } from "lucide-react";
import { RefundPolicy } from "@/components/refund-policy";
import { BOOKING_TONE } from "@/components/require-auth";
import { Badge, Spinner, cx } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { durationLabel, fmtDate, fmtTime } from "@/lib/format";
import type { BookingDetail } from "@/lib/types";

const INVALID = ["CANCELLED", "EXPIRED", "NO_SHOW"];

/** Chiptadagi to'lov usuli: tasdiqlangan to'lovdan, bo'lmasa bron rejimidan. */
function methodKey(b: BookingDetail): MessageKey {
  const paid = (b.payments ?? []).filter((p) => ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)).at(-1);
  if (paid?.method === "CARD_TRANSFER" || paid?.method === "CASH" || paid?.method === "TERMINAL") return `ticket.method.${paid.method}`;
  if (paid) return "ticket.method.ONLINE";
  if (b.price_snapshot?.payment_mode === "AT_CLUB") return "ticket.method.AT_CLUB";
  return b.transfer ? "ticket.method.CARD_TRANSFER" : "ticket.method.ONLINE";
}

/**
 * Bron chiptasi: klub, filial, sana/vaqt, band qilingan joylar (xona · joy · turi · narx), summalar,
 * to'lov usuli, kod + kichik QR (faqat CONFIRMED/CHECKED_IN), qaytarish shartlari. `#booking-ticket` — PNG qilib yuklab olish uchun.
 */
export function BookingTicket({ booking: b, qrImg, showQr }: { booking: BookingDetail; qrImg: string | null; showQr: boolean }) {
  const { t, locale } = useI18n();
  const tz = b.branch.timezone;
  const money = (n: number) => formatMoney(n, locale);
  const invalid = INVALID.includes(b.status);
  const unpaid = b.status === "PENDING_PAYMENT";
  const items = [...b.items].sort((x, y) => (x.device?.room?.name ?? "").localeCompare(y.device?.room?.name ?? "") || (x.device?.name ?? "").localeCompare(y.device?.name ?? "", undefined, { numeric: true }));
  const logo = b.club?.logo_url ?? b.branch.club.logo_url;

  return (
    <article id="booking-ticket" className={cx("gc-ticket overflow-hidden rounded-3xl border border-line bg-surface", invalid && "opacity-70")}>
      <header className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
          ) : (
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent font-display text-xl font-bold text-on-accent">{b.branch.club.name.slice(0, 1)}</div>
          )}
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted">{t("ticket.title")}</div>
            <div className="truncate font-display text-xl font-bold">{b.branch.club.name}</div>
            <div className="flex items-start gap-1 text-[13px] text-muted">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {b.branch.name} · {b.branch.address}
              </span>
            </div>
          </div>
        </div>
        <Badge tone={BOOKING_TONE[b.status]}>{t(`bookingStatus.${b.status}` as MessageKey)}</Badge>
      </header>

      {(unpaid || invalid) && (
        <div className={cx("mx-5 mb-3 rounded-xl px-3 py-2 text-center text-xs font-bold uppercase tracking-wider", unpaid ? "bg-warn/15 text-warn" : "bg-danger/15 text-danger-soft")}>
          {unpaid ? t("ticket.unpaid") : t("ticket.invalid")}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 px-5">
        <Cell icon={CalendarDays} label={t("ticket.date")} value={fmtDate(b.start_at, t, tz)} />
        <Cell icon={Clock} label={t("ticket.time")} value={`${fmtTime(b.start_at, tz)}–${fmtTime(b.end_at, tz)}`} />
        <Cell icon={Hourglass} label={t("ticket.duration")} value={durationLabel(b.duration_minutes, t)} />
      </div>

      <section className="px-5 pt-4">
        <div className="mb-2 text-[13px] font-bold">
          {t("ticket.seats")} · {items.length}
        </div>
        <div className="overflow-hidden rounded-2xl border border-line-soft">
          <div className="grid grid-cols-[1.2fr_1fr_0.8fr_auto] gap-2 bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>{t("ticket.room")}</span>
            <span>{t("ticket.seat")}</span>
            <span>{t("ticket.type")}</span>
            <span className="text-right">{t("ticket.price")}</span>
          </div>
          {items.map((i) => (
            <div key={i.id} className="grid grid-cols-[1.2fr_1fr_0.8fr_auto] items-center gap-2 border-t border-line-soft px-3 py-2.5 text-sm">
              <span className="truncate text-muted">{i.device?.room?.name ?? t("ticket.noRoom")}</span>
              <span className="truncate font-bold">{i.device?.name ?? "—"}</span>
              <span className="truncate text-muted">{i.device ? t(`deviceType.${i.device.type}` as MessageKey) : "—"}</span>
              <span className="text-right font-semibold tabular-nums">{money(i.price_amount)}</span>
            </div>
          ))}
        </div>
      </section>

      <dl className="space-y-1.5 px-5 pt-4 text-sm">
        {b.discount_amount > 0 && (
          <>
            <Row label={t("ticket.subtotal")} value={money(b.subtotal_amount)} />
            <Row label={t("ticket.discount")} value={`−${money(b.discount_amount)}`} />
          </>
        )}
        <Row label={t("book.total")} value={money(b.total_amount)} strong />
        {b.paid_amount > 0 && <Row label={t("booking.paid")} value={money(b.paid_amount)} />}
        {b.amount_due > 0 && <Row label={t("booking.due")} value={money(b.amount_due)} warn />}
        {b.refund_amount != null && b.refund_amount > 0 && <Row label={t("booking.refund")} value={money(b.refund_amount)} />}
        <Row label={t("ticket.method")} value={t(methodKey(b))} />
      </dl>

      {/* Yirtiladigan chiziq: ikki chetida "teshik" */}
      <div className="gc-ticket-perf my-5" aria-hidden />

      <div className="flex items-center gap-4 px-5">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{t("booking.code")}</div>
          <div className="font-mono text-2xl font-bold tracking-widest">{b.code}</div>
          {showQr && <div className="mt-1 text-xs text-muted">{t("booking.showQr")}</div>}
        </div>
        {showQr && (
          <div className="grid h-[120px] w-[120px] shrink-0 place-items-center rounded-xl bg-white p-1.5">
            {qrImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImg} alt={b.code} width={108} height={108} />
            ) : (
              <Spinner className="h-5 w-5 text-black" />
            )}
          </div>
        )}
      </div>

      <div className="p-5 pt-4">
        <RefundPolicy policy={b.cancellation_policy} preview={b.can_cancel ? b.refund_preview : null} paid={b.paid_amount} />
      </div>
    </article>
  );
}

function Cell({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-0.5 font-display text-base font-bold tabular-nums sm:text-lg">{value}</div>
    </div>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={cx("text-right tabular-nums", strong ? "font-display text-lg font-bold text-accent" : "font-semibold", warn && "text-warn")}>{value}</dd>
    </div>
  );
}
