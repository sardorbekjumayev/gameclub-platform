"use client";

import { formatMoney } from "@gc/types";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Payment = { id: string; amount: number; status: string; booking_id: string | null; provider: string };

/**
 * DEMO to'lov sahifasi — haqiqiy provayder (Payme/Click, Phase 6) ulanguncha checkout o'rnini bosadi.
 * Natija `POST /payments/:id/demo/confirm` orqali webhook kabi qayta ishlanadi.
 */
export default function DemoPayPage() {
  return (
    <RequireAuth>
      <DemoPay />
    </RequireAuth>
  );
}

function DemoPay() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const payment = useApi<Payment>(`/payments/${paymentId}`);
  const [busy, setBusy] = useState<"ok" | "fail" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm(success: boolean) {
    setBusy(success ? "ok" : "fail");
    setError(null);
    try {
      await session.post(`/payments/${paymentId}/demo/confirm`, { success });
      const bookingId = payment.data?.booking_id;
      router.replace(bookingId ? `/bookings/${bookingId}${success ? "?paid=1" : ""}` : "/bookings");
    } catch (e) {
      setError(errorText(e));
      setBusy(null);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm space-y-5 p-6">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-warn">{t("pay.demoBadge")}</div>
          <h1 className="font-display text-2xl font-bold">{t("pay.title")}</h1>
        </div>
        {payment.loading && <Spinner className="mx-auto h-6 w-6" />}
        {payment.error && <Alert>{payment.error}</Alert>}
        {payment.data && (
          <>
            <div className="rounded-2xl bg-surface-2 p-5 text-center">
              <div className="text-sm text-muted">{t("pay.amount")}</div>
              <div className="font-display text-3xl font-bold text-accent tabular-nums">{formatMoney(payment.data.amount, locale)}</div>
            </div>
            <p className="text-xs text-muted">{t("pay.demoHint")}</p>
            {error && <Alert>{error}</Alert>}
            {payment.data.status === "PAID" ? (
              <Alert tone="success">{t("pay.alreadyPaid")}</Alert>
            ) : (
              <div className="space-y-2">
                <Button size="lg" className="w-full" loading={busy === "ok"} disabled={!!busy} onClick={() => confirm(true)}>
                  {t("pay.success")}
                </Button>
                <Button variant="secondary" className="w-full" loading={busy === "fail"} disabled={!!busy} onClick={() => confirm(false)}>
                  {t("pay.fail")}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </main>
  );
}
