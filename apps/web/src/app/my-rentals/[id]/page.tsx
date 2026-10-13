"use client";

import { formatMoney } from "@gc/types";
import { AlertTriangle, Check, MapPin, Navigation, Phone, ShieldCheck, Store, Truck, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { RENTAL_TONE, RentalThumb } from "@/components/rental-card";
import { RequireAuth } from "@/components/require-auth";
import { Alert, Badge, Button, Card, Input, Spinner, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime } from "@/lib/format";
import { session } from "@/lib/session";
import type { RentalOrder } from "@/lib/types";
import { SocialFollowCard } from "@/components/social";
import { idemKey, useApi } from "@/lib/use-api";

export default function RentalOrderPage() {
  return (
    <RequireAuth>
      <RentalOrderView />
    </RequireAuth>
  );
}

const STEPS = ["REQUESTED", "CONFIRMED", "ACTIVE", "RETURNED"] as const;

function RentalOrderView() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const res = useApi<RentalOrder>(`/rentals/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (res.loading && !res.data) return <Spinner className="mx-auto my-24 h-6 w-6" />;
  if (res.error || !res.data)
    return (
      <main className="mx-auto max-w-xl flex-1 px-4 py-16">
        <Alert>{res.error ?? t("rent.notFound")}</Alert>
      </main>
    );

  const r = res.data;
  const tz = r.branch?.timezone;
  const money = (n: number) => formatMoney(n, locale);
  const when = (iso: string) => `${fmtDate(iso, t, tz)}, ${fmtTime(iso, tz)}`;
  const stepIdx = STEPS.indexOf(r.status as (typeof STEPS)[number]);
  const closed = stepIdx === -1;
  const b = r.branch;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const out = await session.post<RentalOrder>(`/rentals/${r.id}/cancel`, reason.trim() ? { reason: reason.trim() } : {}, { "Idempotency-Key": idemKey() });
      res.setData(out.data);
      setCancelling(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-8 sm:px-8">
      <Link href="/my-rentals" className="text-sm text-muted hover:text-fg">
        ← {t("rent.mine")}
      </Link>

      <Card className="space-y-5">
        <div className="flex items-start gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl">
            <RentalThumb item={r.item_snapshot} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={RENTAL_TONE[r.status]}>{t(`rentalStatus.${r.status}` as MessageKey)}</Badge>
              {r.is_overdue && (
                <Badge tone="red">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {t("rent.overdue")}
                </Badge>
              )}
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold leading-tight">
              {r.item_snapshot.name}
              {r.quantity > 1 && <span className="text-muted"> × {r.quantity}</span>}
            </h1>
            <div className="font-mono text-sm text-muted">{r.code}</div>
          </div>
        </div>

        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">{t(`rent.statusHint.${r.status}` as MessageKey)}</p>
        {(r.status === "CONFIRMED" || r.status === "ACTIVE") && <SocialFollowCard />}

        {!closed && (
          <ol className="grid grid-cols-4 gap-2">
            {STEPS.map((s, i) => (
              <li key={s} className="space-y-1.5">
                <div className={cx("h-1.5 rounded-full", i <= stepIdx ? "bg-accent" : "bg-surface-3")} />
                <div className={cx("text-[11px] font-semibold sm:text-xs", i <= stepIdx ? "text-fg" : "text-muted")}>{t(`rent.step.${s}` as MessageKey)}</div>
              </li>
            ))}
          </ol>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Info label={t(r.fulfillment === "DELIVERY" ? "rent.deliveryAt" : "rent.pickupAt")} value={when(r.start_at)} />
          <Info label={t("rent.returnBy")} value={when(r.end_at)} danger={r.is_overdue} />
          <Info label={t("rent.duration")} value={t(r.rate_unit === "HOUR" ? "rent.hoursN" : "rent.daysN", { n: r.units })} />
          <Info
            label={t("rent.form.how")}
            value={
              <span className="inline-flex items-center gap-1.5">
                {r.fulfillment === "DELIVERY" ? <Truck className="h-4 w-4" /> : <Store className="h-4 w-4" />}
                {t(r.fulfillment === "DELIVERY" ? "rent.delivery" : "rent.pickup")}
              </span>
            }
          />
        </div>
        {r.delivery_address && (
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            {r.delivery_address}
          </div>
        )}
        {r.cancel_reason && <Alert tone="info">{r.cancel_reason}</Alert>}
      </Card>

      <Card className="space-y-2 text-sm">
        <Row label={`${money(r.unit_price)} × ${t(r.rate_unit === "HOUR" ? "rent.hoursN" : "rent.daysN", { n: r.units })}${r.quantity > 1 ? ` × ${r.quantity}` : ""}`} value={money(r.subtotal_amount)} />
        {r.delivery_fee_amount > 0 && <Row label={t("rent.delivery")} value={money(r.delivery_fee_amount)} />}
        {r.late_fee_amount > 0 && <Row label={t("rent.lateFee")} value={money(r.late_fee_amount)} />}
        <div className="flex items-baseline justify-between border-t border-line pt-2">
          <span className="font-bold">{t("rent.total")}</span>
          <span className="font-display text-2xl font-bold tabular-nums">{money(r.total_amount)}</span>
        </div>
        <Row label={t("rent.paidLabel")} value={money(r.paid_amount)} muted />
        {(r.amount_due ?? 0) > 0 && <Row label={t("rent.dueAtClub")} value={money(r.amount_due ?? 0)} />}
        {r.deposit_amount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-accent" />
              {t("rent.depositReturnable")}
            </span>
            <span className="text-right">
              <b className="tabular-nums">{money(r.deposit_amount)}</b>
              {r.deposit_status !== "NONE" && <span className="block text-xs text-muted">{t(`rent.deposit.${r.deposit_status}` as MessageKey)}</span>}
            </span>
          </div>
        )}
      </Card>

      {b && (
        <Card className="space-y-3">
          <div className="font-bold">{b.club.name}</div>
          <div className="flex items-start gap-2 text-sm text-muted">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
            {b.name} · {b.address}
          </div>
          <div className="flex flex-wrap gap-2">
            {(b.phone ?? b.club.phone) && (
              <a href={`tel:${b.phone ?? b.club.phone}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-bold hover:border-accent/50">
                <Phone className="h-4 w-4 text-accent" />
                {t("rent.call")}
              </a>
            )}
            {b.latitude != null && (
              <a
                href={`https://yandex.uz/maps/?rtext=~${b.latitude},${b.longitude}&rtt=auto`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-bold hover:border-accent/50"
              >
                <Navigation className="h-4 w-4 text-accent" />
                {t("rent.route")}
              </a>
            )}
          </div>
        </Card>
      )}

      {error && <Alert>{error}</Alert>}
      {r.can_cancel &&
        (cancelling ? (
          <Card className="space-y-3">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("rent.cancelReason")} maxLength={300} />
            <div className="flex gap-2">
              <Button variant="danger" loading={busy} onClick={cancel}>
                <Check className="h-4 w-4" />
                {t("rent.cancelConfirm")}
              </Button>
              <Button variant="ghost" onClick={() => setCancelling(false)}>
                {t("rent.keep")}
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="danger" className="w-full" onClick={() => setCancelling(true)}>
            <X className="h-4 w-4" />
            {t("rent.cancel")}
          </Button>
        ))}
    </main>
  );
}

function Info({ label, value, danger }: { label: string; value: React.ReactNode; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("font-semibold", danger && "text-danger-soft")}>{value}</div>
    </div>
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
