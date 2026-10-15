"use client";

import { formatMoney } from "@gc/types";
import { Check, Copy, CreditCard, ExternalLink, FileText, Link2, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, Field, Input, Spinner, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { BookingDetail } from "@/lib/types";
import { useSubmitKey } from "@/lib/use-api";

/** "8600123412345678" → "8600 1234 1234 5678" */
export const groupCard = (n: string) => n.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ");

/** Serverdagi UPLOAD_MAX_MB bilan bir xil (standart 10 MB) — katta faylni yuklashdan oldin to'xtatamiz. */
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

type Channel = "CARD" | "LINK";
type Receipt = { id: string; name: string; preview: string | null };

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

/** Chek (skrinshot/PDF): tanlanganda darhol yuklanadi, to'lov yuborilganda id'si biriktiriladi. */
function ReceiptPicker({ value, onChange, required }: { value: Receipt | null; onChange: (r: Receipt | null) => void; required: boolean }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_RECEIPT_BYTES) {
      setError(t("transfer.receiptTooBig"));
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("purpose", "RECEIPT");
      form.append("file", file);
      const res = await session.post<{ id: string }>("/files", form);
      onChange({ id: res.data.id, name: file.name, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[13px] font-semibold text-muted">{required ? t("transfer.receiptRequired") : t("transfer.receiptOptional")}</div>
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-accent/40 bg-surface p-2.5">
          {value.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- lokal blob: oldindan ko'rish
            <img src={value.preview} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-surface-2">
              <FileText className="h-6 w-6 text-muted" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{value.name}</div>
            <div className="text-xs text-accent">{t("transfer.receiptAttached")}</div>
          </div>
          <button type="button" onClick={() => onChange(null)} className="rounded-lg p-2 text-muted hover:text-fg" aria-label={t("transfer.receiptRemove")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface px-4 py-4 text-sm font-semibold text-muted transition hover:border-accent hover:text-fg disabled:opacity-60"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
          {busy ? t("transfer.receiptUploading") : t("transfer.receiptPick")}
        </button>
      )}
      <input ref={input} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <p className="text-xs text-muted">{t("transfer.receiptHint")}</p>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}

/**
 * Klubga o'tkazma (CARD_TRANSFER, docs/01-API.md §6.10): klub kartasi va/yoki to'lov havolasi (Click/Payme/QR) —
 * mijoz tanlaydi, to'laydi, "to'ladim" deydi (ixtiyoriy yoki majburiy chek bilan). Bron darhol tasdiqlanadi, operator keyin tekshiradi.
 */
export function TransferPay({ booking: b, left, onSent }: { booking: BookingDetail; left: number | null; onSent: () => void }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const tr = b.transfer!;
  const channels: Channel[] = [...(tr.card_number ? (["CARD"] as const) : []), ...(tr.link ? (["LINK"] as const) : [])];
  const [channel, setChannel] = useState<Channel>(channels[0] ?? "CARD");
  const [last4, setLast4] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const submitKey = useSubmitKey();
  const amount = formatMoney(tr.amount, locale);
  const linkLabel = tr.link?.label || t("transfer.linkDefault");

  if (tr.pending) {
    const pl = tr.pending.provider_payload ?? {};
    return (
      <div className="space-y-2 rounded-2xl border border-accent/40 bg-accent/10 p-4">
        <div className="flex items-center gap-2 font-bold">
          <Spinner className="h-4 w-4" />
          {t("transfer.pendingTitle")}
        </div>
        <div className="text-sm">
          {pl.channel === "LINK"
            ? t("transfer.pendingBodyLink", { label: pl.link_label || t("transfer.linkDefault"), amount: formatMoney(tr.pending.amount, locale) })
            : t("transfer.pendingBody", { last4: pl.payer_card_last4 ?? "····", amount: formatMoney(tr.pending.amount, locale) })}
        </div>
        {tr.pending.receipt_url && (
          <a href={tr.pending.receipt_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:underline">
            <Paperclip className="h-4 w-4" /> {t("transfer.receiptView")}
          </a>
        )}
        <div className="text-xs text-muted">{t("transfer.pendingHint")}</div>
      </div>
    );
  }

  const canSubmit = (channel === "LINK" || last4.length === 4) && (!tr.receipt_required || !!receipt);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Ikki marta bosish: ref darhol to'sadi; bir xil tana — bir xil Idempotency-Key (dublikat to'lov yaratilmaydi)
    if (submitting.current || !canSubmit) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const body = {
      booking_id: b.id,
      channel,
      ...(channel === "CARD" ? { payer_card_last4: last4 } : {}),
      ...(receipt ? { receipt_file_id: receipt.id } : {}),
    };
    try {
      await session.post("/payments/transfer", body, { "Idempotency-Key": submitKey(body) });
      onSent();
    } catch (err) {
      setError(errorText(err));
      submitting.current = false;
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

      {channels.length > 1 && (
        <div className="grid grid-cols-2 gap-2" role="tablist">
          {channels.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              onClick={() => setChannel(c)}
              className={cx(
                "flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition",
                channel === c ? "bg-accent text-on-accent" : "border border-line bg-surface hover:border-muted/60",
              )}
            >
              {c === "CARD" ? <CreditCard className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {c === "CARD" ? t("transfer.tabCard") : linkLabel}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3 rounded-2xl bg-surface p-4">
        {channel === "CARD" && tr.card_number && (
          <div>
            <div className="text-xs text-muted">{t("transfer.card")}</div>
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-xl font-bold tracking-wider tabular-nums sm:text-2xl">{groupCard(tr.card_number)}</div>
              <CopyButton value={tr.card_number} />
            </div>
            {tr.card_holder && <div className="text-sm font-semibold text-muted">{tr.card_holder}</div>}
          </div>
        )}
        {channel === "LINK" && tr.link && (
          <a
            href={tr.link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[54px] w-full items-center justify-center gap-2 rounded-[14px] bg-accent px-6 text-base font-bold text-on-accent transition hover:bg-accent-hover"
          >
            {t("transfer.openLink", { label: linkLabel })} <ExternalLink className="h-4 w-4" />
          </a>
        )}
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
        {(channel === "CARD" ? [t("transfer.step1"), t("transfer.step2", { amount }), t("transfer.step3")] : [t("transfer.linkStep1", { label: linkLabel }), t("transfer.linkStep2", { amount }), t("transfer.linkStep3")]).map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="space-y-3">
        {channel === "CARD" && (
          <>
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
          </>
        )}
        <ReceiptPicker value={receipt} onChange={setReceipt} required={tr.receipt_required} />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!canSubmit}>
          {channel === "CARD" ? t("transfer.submit") : t("transfer.submitLink")}
        </Button>
      </form>
    </div>
  );
}
