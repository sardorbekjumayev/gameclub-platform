"use client";

import { formatMoney } from "@gc/types";
import { Check, Copy, CreditCard } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Field, Input, Spinner, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { BookingDetail } from "@/lib/types";
import { idemKey } from "@/lib/use-api";

/** "8600123412345678" → "8600 1234 1234 5678" */
export const groupCard = (n: string) => n.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");

function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      className={cx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition", done ? "border-accent text-accent" : "border-line bg-surface hover:border-muted/60")}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? t("transfer.copied") : t("transfer.copy")}
    </button>
  );
}

/**
 * Klub kartasiga o'tkazma (CARD_TRANSFER, docs/01-API.md §6.10): karta, summa, izoh uchun bron kodi va "pul o'tkazdim" formasi.
 * Yuborilgach bron darhol tasdiqlanadi (chipta faol), to'lovni operator keyin tekshiradi — `transfer.pending` ko'rinishi.
 */
export function TransferPay({ booking: b, left, onSent }: { booking: BookingDetail; left: number | null; onSent: () => void }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const tr = b.transfer!;
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = formatMoney(tr.amount, locale);

  if (tr.pending) {
    const pl = tr.pending.provider_payload ?? {};
    return (
      <div className="space-y-2 rounded-2xl border border-accent/40 bg-accent/10 p-4">
        <div className="flex items-center gap-2 font-bold">
          <Spinner className="h-4 w-4" />
          {t("transfer.pendingTitle")}
        </div>
        <div className="text-sm">{t("transfer.pendingBody", { last4: pl.payer_card_last4 ?? "····", amount: formatMoney(tr.pending.amount, locale) })}</div>
        <div className="text-xs text-muted">{t("transfer.pendingHint")}</div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.post("/payments/transfer", { booking_id: b.id, payer_card_last4: last4 }, { "Idempotency-Key": idemKey() });
      onSent();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-warn/40 bg-warn/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-display text-lg font-bold">
          <CreditCard className="h-5 w-5 text-accent" />
          {t("transfer.title")}
        </div>
        {left !== null && left > 0 && <div className="text-sm font-bold tabular-nums text-warn">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}</div>}
      </div>
      {tr.rejected && <Alert>{t("transfer.rejected", { reason: tr.rejected.failed_reason ?? "—" })}</Alert>}

      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <div>
          <div className="text-xs text-muted">{t("transfer.card")}</div>
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-xl font-bold tracking-wider tabular-nums sm:text-2xl">{groupCard(tr.card_number)}</div>
            <CopyButton value={tr.card_number} />
          </div>
          {tr.card_holder && <div className="text-sm font-semibold text-muted">{tr.card_holder}</div>}
        </div>
        <div className="border-t border-line-soft pt-3">
          <div className="text-xs text-muted">{t("transfer.amount")}</div>
          <div className="flex items-center justify-between gap-3">
            <div className="font-display text-2xl font-bold text-accent tabular-nums">{amount}</div>
            <CopyButton value={String(Math.round(tr.amount / 100))} />
          </div>
        </div>
        <div className="border-t border-line-soft pt-3">
          <div className="text-xs text-muted">{t("transfer.comment")}</div>
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-lg font-bold tracking-wider">{b.code}</div>
            <CopyButton value={b.code} />
          </div>
        </div>
      </div>

      <ol className="space-y-1.5 text-sm">
        {[t("transfer.step1"), t("transfer.step2", { amount }), t("transfer.step3")].map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="space-y-3">
        <div className="sm:max-w-[220px]">
          <Field label={t("transfer.payerLast4")}>
            <Input
              value={last4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              pattern="\d{4}"
              placeholder="1234"
              required
              className="font-mono tracking-widest"
            />
          </Field>
        </div>
        <p className="text-xs text-muted">{t("transfer.payerHint")}</p>
        {error && <Alert>{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={last4.length !== 4}>
          {t("transfer.submit")}
        </Button>
      </form>
    </div>
  );
}
