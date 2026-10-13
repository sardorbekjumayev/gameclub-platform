"use client";

import { formatMoney } from "@gc/types";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { BookingReview } from "@/components/booking-review";
import { BookingTicket } from "@/components/booking-ticket";
import { SocialFollowCard } from "@/components/social";
import { ReschedulePanel } from "@/components/reschedule-panel";
import { RequireAuth } from "@/components/require-auth";
import { TransferPay } from "@/components/transfer-pay";
import { Alert, Button, Spinner, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { BookingDetail, PaymentProvider } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

const BLANK_PX = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

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
  const transfer = b?.transfer ?? null;
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const left = useCountdown(b?.status === "PENDING_PAYMENT" && b.price_snapshot?.payment_mode !== "AT_CLUB" ? b.hold_expires_at : null);

  useEffect(() => {
    if (!qr.data) return;
    let alive = true;
    QRCode.toDataURL(qr.data.qr_payload, { width: 216, margin: 1, color: { dark: "#0E0F13", light: "#FFFFFF" } }).then((url) => alive && setQrImg(url));
    return () => {
      alive = false;
    };
  }, [qr.data]);

  // To'lov provayderlari (endpoint hali bo'lmasa — DEMO)
  const [providers, setProviders] = useState<PaymentProvider[] | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [showResched, setShowResched] = useState(false);
  const payOnlineNow = b?.status === "PENDING_PAYMENT" && b.price_snapshot?.payment_mode !== "AT_CLUB" && !b.transfer;
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

  // Kartaga o'tkazma klub tomonidan tekshirilayotganda — har 10 s holatni yangilash
  const { reload } = booking;
  const transferPending = !!transfer?.pending;
  useEffect(() => {
    if (!transferPending) return;
    const iv = setInterval(reload, 10_000);
    return () => clearInterval(iv);
  }, [transferPending, reload]);

  // Hold muddati tugasa — holatni yangilash
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

  /** Chiptani PNG qilib yuklab olish (sahifa fonida, 2x sifat). Tashqi logotip CORS'da ochilmasa — o'rniga bo'sh joy. */
  async function download() {
    const node = document.getElementById("booking-ticket");
    if (!node || !b) return;
    setBusy("download");
    setMsg(null);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, { pixelRatio: 2, cacheBust: true, backgroundColor: getComputedStyle(document.body).backgroundColor, imagePlaceholder: BLANK_PX });
      if (!blob) throw new Error("empty");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gameclub-${b.code}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setMsg({ tone: "error", text: t("ticket.downloadFailed") });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    const rp = b?.refund_preview;
    const question = rp && b.paid_amount > 0 ? t("booking.confirmCancelPreview", { amount: formatMoney(rp.amount, locale), p: rp.percent }) : t("booking.confirmCancelSimple");
    if (!confirm(question)) return;
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

      {/* Kartaga o'tkazma: to'lanmagan bron yoki qolgan qarz (masalan ko'chirishda narx oshganda); "klubda to'lash" tanlanganda emas */}
      {transfer && b.price_snapshot?.payment_mode !== "AT_CLUB" && (
        <TransferPay
          booking={b}
          left={payOnline ? left : null}
          onSent={() => {
            setMsg(null);
            reload();
          }}
        />
      )}

      {payOnline && !transfer && (
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

      <BookingTicket booking={b} qrImg={qrImg} showQr={showQr} />
      {showQr && <SocialFollowCard />}

      <div className="grid grid-cols-2 gap-2">
        <a
          href={`https://yandex.uz/maps/?rtext=~${b.branch.latitude},${b.branch.longitude}&rtt=auto`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-muted/60"
        >
          {t("booking.route")}
        </a>
        <Button variant="secondary" loading={busy === "download"} onClick={download}>
          <Download className="h-4 w-4" />
          {t("ticket.download")}
        </Button>
        {canReschedule && !showResched && (
          <Button variant="secondary" onClick={() => setShowResched(true)}>
            {t("booking.reschedule.open")}
          </Button>
        )}
        {b.can_cancel && (
          <Button variant="danger" loading={busy === "cancel"} onClick={cancel}>
            {t("booking.cancel")}
          </Button>
        )}
      </div>
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
      {b.status === "COMPLETED" && <BookingReview key={b.review?.id ?? "new"} booking={b} onChange={reload} />}
    </main>
  );
}
