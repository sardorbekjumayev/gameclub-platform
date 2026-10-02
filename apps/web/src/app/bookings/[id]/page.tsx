"use client";

import { formatMoney } from "@gc/types";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useState } from "react";
import { BookingReview } from "@/components/booking-review";
import { ReschedulePanel } from "@/components/reschedule-panel";
import { BOOKING_TONE, RequireAuth } from "@/components/require-auth";
import { Alert, Badge, Button, Card, Spinner, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime } from "@/lib/format";
import { session } from "@/lib/session";
import type { BookingDetail, PaymentProvider } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

export default function BookingPage() {
  return (
    <RequireAuth>
      <Suspense>
        <Booking />
      </Suspense>
    </RequireAuth>
  );
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [until]);
  if (!until || !now) return null;
  return Math.max(0, Math.round((new Date(until).getTime() - now) / 1000));
}

function Booking() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const booking = useApi<BookingDetail>(`/bookings/${id}`);
  const b = booking.data;
  const showQr = !!b && ["CONFIRMED", "CHECKED_IN"].includes(b.status);
  const qr = useApi<{ code: string; qr_payload: string }>(showQr ? `/bookings/${id}/qr` : null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const left = useCountdown(b?.status === "PENDING_PAYMENT" && b.price_snapshot?.payment_mode !== "AT_CLUB" ? b.hold_expires_at : null);

  useEffect(() => {
    if (!qr.data) return;
    let alive = true;
    QRCode.toDataURL(qr.data.qr_payload, { width: 240, margin: 1, color: { dark: "#0E0F13", light: "#FFFFFF" } }).then((url) => alive && setQrImg(url));
    return () => {
      alive = false;
    };
  }, [qr.data]);

  // To'lov provayderlari (endpoint hali bo'lmasa — DEMO)
  const [providers, setProviders] = useState<PaymentProvider[] | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [showResched, setShowResched] = useState(false);
  const payOnlineNow = b?.status === "PENDING_PAYMENT" && b.price_snapshot?.payment_mode !== "AT_CLUB";
  useEffect(() => {
    if (!payOnlineNow || providers) return;
    let alive = true;
    session.get<PaymentProvider[]>("/payments/providers").then(
      (r) => {
        if (!alive) return;
        const list = r.data?.length ? r.data : [{ code: "DEMO" }];
        setProviders(list);
        setProvider(list[0].code);
      },
      () => {
        if (!alive) return;
        setProviders([{ code: "DEMO" }]);
        setProvider("DEMO");
      },
    );
    return () => {
      alive = false;
    };
  }, [payOnlineNow, providers]);

  // `?paid=1` — to'lovdan qaytgach bron holatini 3 s da bir tekshirish (~60 s gacha)
  const paidReturn = params.get("paid") === "1";
  const [pollDone, setPollDone] = useState(false);
  const stillPending = b?.status === "PENDING_PAYMENT";
  useEffect(() => {
    if (!paidReturn || !stillPending || pollDone) return;
    let n = 0;
    const iv = setInterval(() => {
      n += 1;
      booking.reload();
      if (n >= 20) setPollDone(true);
    }, 3000);
    return () => clearInterval(iv);
  }, [paidReturn, stillPending, pollDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hold muddati tugasa — holatni yangilash
  const { reload } = booking;
  useEffect(() => {
    if (left === 0) reload();
  }, [left, reload]);

  async function pay() {
    setBusy("pay");
    setMsg(null);
    try {
      const res = await session.post<{ payment_id: string; checkout_url: string }>("/payments", { booking_id: id, provider: provider ?? "DEMO", return_url: `${window.location.origin}/bookings/${id}?paid=1` }, { "Idempotency-Key": idemKey() });
      const url = res.data.checkout_url;
      if (url.startsWith("http")) window.location.href = url;
      else router.push(url);
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm(t("booking.confirmCancel"))) return;
    setBusy("cancel");
    setMsg(null);
    try {
      const res = await session.post<{ refunded_amount: number }>(`/bookings/${id}/cancel`, {}, { "Idempotency-Key": idemKey() });
      setMsg({ tone: "success", text: res.data.refunded_amount > 0 ? t("booking.cancelledRefund", { amount: formatMoney(res.data.refunded_amount, locale) }) : t("booking.cancelled") });
      reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  if (booking.loading && !b) return <Spinner className="mx-auto my-24 h-6 w-6" />;
  if (booking.error || !b)
    return (
      <main className="mx-auto max-w-xl flex-1 px-4 py-16">
        <Alert>{booking.error}</Alert>
      </main>
    );

  const tz = b.branch.timezone;
  const canReschedule = b.can_reschedule;
  const payOnline = b.status === "PENDING_PAYMENT" && b.price_snapshot?.payment_mode !== "AT_CLUB";

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-5 px-4 py-8">
      <Link href="/bookings" className="text-sm text-muted hover:text-fg">
        ← {t("bookings.title")}
      </Link>
      {paidReturn && b.status === "CONFIRMED" && <Alert tone="success">{t("booking.paidOk")}</Alert>}
      {paidReturn && b.status === "PENDING_PAYMENT" && !pollDone && (
        <Alert tone="info">
          <span className="inline-flex items-center gap-2">
            <Spinner className="h-4 w-4" />
            {t("booking.checkingPayment")}
          </span>
        </Alert>
      )}
      {paidReturn && b.status === "PENDING_PAYMENT" && pollDone && <Alert tone="info">{t("booking.paymentPending")}</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-2xl font-bold">{b.branch.club.name}</div>
            <div className="text-sm text-muted">
              {b.branch.name} · {b.branch.address}
            </div>
          </div>
          <Badge tone={BOOKING_TONE[b.status]}>{t(`bookingStatus.${b.status}` as never)}</Badge>
        </div>

        {showQr && (
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface-2 p-5">
            {qrImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrImg} alt={b.code} width={240} height={240} className="rounded-xl" />
            ) : (
              <Spinner className="h-6 w-6" />
            )}
            <div className="font-mono text-2xl font-bold tracking-widest">{b.code}</div>
            <div className="text-center text-xs text-muted">{t("booking.showQr")}</div>
          </div>
        )}

        <dl className="space-y-1.5 text-sm">
          <Row label={t("booking.when")} value={`${fmtDate(b.start_at, t, tz)}, ${fmtTime(b.start_at, tz)}–${fmtTime(b.end_at, tz)}`} />
          <Row label={t("booking.devices")} value={b.items.map((i) => i.device?.name ?? "—").join(", ")} />
          {!showQr && <Row label={t("booking.code")} value={b.code} mono />}
          <Row label={t("book.total")} value={formatMoney(b.total_amount, locale)} />
          {b.paid_amount > 0 && <Row label={t("booking.paid")} value={formatMoney(b.paid_amount, locale)} />}
          {b.amount_due > 0 && <Row label={t("booking.due")} value={formatMoney(b.amount_due, locale)} />}
          {b.refund_amount != null && b.refund_amount > 0 && <Row label={t("booking.refund")} value={formatMoney(b.refund_amount, locale)} />}
        </dl>

        {payOnline && (
          <div className="space-y-2 rounded-2xl border border-warn/40 bg-warn/10 p-4">
            <div className="text-sm">{left !== null && left > 0 ? t("booking.payWithin", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` }) : t("booking.payNow")}</div>
            {providers && providers.length > 1 && (
              <div className="grid grid-cols-3 gap-2">
                {providers.map((p) => (
                  <button
                    key={p.code}
                    onClick={() => setProvider(p.code)}
                    className={cx("h-11 rounded-xl text-sm font-bold", provider === p.code ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}
                  >
                    {p.name || p.code}
                  </button>
                ))}
              </div>
            )}
            <Button size="lg" className="w-full" loading={busy === "pay"} disabled={!providers} onClick={pay}>
              {t("booking.payAmount", { amount: formatMoney(b.amount_due, locale) })}
            </Button>
          </div>
        )}
        {b.status === "PENDING_PAYMENT" && b.price_snapshot?.payment_mode === "AT_CLUB" && <Alert tone="info">{t("booking.payAtClub")}</Alert>}
        {b.status === "EXPIRED" && <Alert tone="info">{t("booking.expired")}</Alert>}

        <div className="flex flex-wrap gap-2">
          <a
            href={`https://yandex.uz/maps/?rtext=~${b.branch.latitude},${b.branch.longitude}&rtt=auto`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-muted/60"
          >
            {t("booking.route")}
          </a>
          {canReschedule && !showResched && (
            <Button variant="secondary" className="flex-1" onClick={() => setShowResched(true)}>
              {t("booking.reschedule.open")}
            </Button>
          )}
          {b.can_cancel && (
            <Button variant="danger" className="flex-1" loading={busy === "cancel"} onClick={cancel}>
              {t("booking.cancel")}
            </Button>
          )}
        </div>
      </Card>
      {canReschedule && showResched && (
        <ReschedulePanel
          booking={b}
          onClose={() => setShowResched(false)}
          onDone={() => {
            setShowResched(false);
            setMsg({ tone: "success", text: t("booking.reschedule.done") });
            reload();
          }}
        />
      )}
      {b.can_cancel && <p className="text-xs text-muted">{t("booking.cancelPolicy")}</p>}
      {b.status === "COMPLETED" && <BookingReview key={b.review?.id ?? "new"} booking={b} onChange={reload} />}
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? "font-mono" : "text-right font-semibold"}>{value}</dd>
    </div>
  );
}
