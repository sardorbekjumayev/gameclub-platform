"use client";

import { formatDateTime, formatMoney } from "@gc/types";
import { ArrowDownLeft, ArrowUpRight, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { Empty, LoadState } from "@/components/status";
import { Alert, Badge, Button, Card, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { PaymentRow, RefundRow } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

/**
 * Kartaga o'tkazmalar: mijoz "o'tkazdim" degan to'lovlar (tasdiqlash/rad etish) va
 * klub qo'lda qaytarishi kerak bo'lgan pullar (docs/01-API.md §6.10).
 * `compact` — operator pultida: kutilayotgan narsa bo'lmasa hech narsa ko'rsatmaydi.
 */
export function TransferInbox({ clubId, branchId, refreshKey = 0, compact }: { clubId?: string; branchId?: string; refreshKey?: number; compact?: boolean }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const scope = branchId ? `branch_id=${branchId}` : `club_id=${clubId}`;
  const transfers = useApi<PaymentRow[]>(can("payments.create") ? `/payments?method=CARD_TRANSFER&status=PROCESSING&limit=50&${scope}` : null);
  const refunds = useApi<RefundRow[]>(can("payments.refund") ? `/refunds?status=PENDING&limit=50&${scope}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const reloadT = transfers.reload;
  const reloadR = refunds.reload;
  useEffect(() => {
    if (!refreshKey) return;
    reloadT();
    reloadR();
  }, [refreshKey, reloadT, reloadR]);

  async function run(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: success });
      setRejecting(null);
      setReason("");
      reloadT();
      reloadR();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const list = transfers.data ?? [];
  const back = refunds.data ?? [];
  if (compact && !list.length && !back.length && !msg) return null;
  const money = (n: number) => formatMoney(n, locale);

  return (
    <Card className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {can("payments.create") && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ArrowDownLeft className="h-5 w-5 text-accent" />
            <div className="font-display text-lg font-bold">{t("transfer.inbox.title")}</div>
            {list.length > 0 && <Badge tone="amber">{list.length}</Badge>}
          </div>
          {!compact && <LoadState loading={transfers.loading && !transfers.data} error={transfers.error} onRetry={reloadT} />}
          {transfers.data && list.length === 0 && !compact && <Empty>{t("transfer.inbox.empty")}</Empty>}
          {list.map((p) => (
            <div key={p.id} className="space-y-3 rounded-xl border border-warn/40 bg-warn/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-mono text-sm font-bold">{p.booking_code ?? "—"}</div>
                  <div className="text-sm">
                    {p.provider_payload?.payer_name ? `${p.provider_payload.payer_name} · ` : ""}
                    {t("transfer.inbox.from", { last4: p.provider_payload?.payer_card_last4 ?? "····" })}
                  </div>
                  <div className="text-xs text-muted">
                    {t("transfer.inbox.to", { last4: p.provider_payload?.card_last4 ?? "····" })} · {formatDateTime(p.created_at, undefined, locale)}
                  </div>
                </div>
                <div className="font-display text-2xl font-bold">{money(p.amount)}</div>
              </div>
              <div className="text-xs text-muted">{t("transfer.inbox.hint")}</div>
              {rejecting === p.id ? (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(`r-${p.id}`, () => session.post(`/payments/${p.id}/transfer/reject`, { reason: reason.trim() }, { "Idempotency-Key": idemKey() }), t("transfer.inbox.rejected"));
                  }}
                >
                  <Input className="min-w-56 flex-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("transfer.inbox.reasonPh")} minLength={2} maxLength={300} required autoFocus />
                  <Button type="submit" variant="danger" loading={busy === `r-${p.id}`}>
                    {t("transfer.inbox.reject")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setRejecting(null)}>
                    {t("common.cancel")}
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    loading={busy === `c-${p.id}`}
                    onClick={() => run(`c-${p.id}`, () => session.post(`/payments/${p.id}/transfer/confirm`, {}, { "Idempotency-Key": idemKey() }), t("transfer.inbox.confirmed"))}
                  >
                    {t("transfer.inbox.confirm")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRejecting(p.id);
                      setReason(t("transfer.inbox.defaultReason"));
                    }}
                  >
                    {t("transfer.inbox.notReceived")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {can("payments.refund") && (!compact || back.length > 0) && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-danger-soft" />
            <div className="font-display text-lg font-bold">{t("refund.inbox.title")}</div>
            {back.length > 0 && <Badge tone="red">{back.length}</Badge>}
          </div>
          {!compact && <LoadState loading={refunds.loading && !refunds.data} error={refunds.error} onRetry={reloadR} />}
          {refunds.data && back.length === 0 && !compact && <Empty>{t("refund.inbox.empty")}</Empty>}
          {back.map((r) => {
            const name = [r.customer?.first_name, r.customer?.last_name].filter(Boolean).join(" ") || r.payment?.provider_payload?.payer_name || "—";
            return (
              <div key={r.id} className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="font-mono text-sm font-bold">{r.booking?.code ?? "—"}</div>
                    <div className="text-sm font-semibold">{name}</div>
                    {r.customer?.phone && (
                      <a href={`tel:${r.customer.phone}`} className="inline-flex items-center gap-1 text-sm text-accent">
                        <Phone className="h-3.5 w-3.5" /> {r.customer.phone}
                      </a>
                    )}
                    <div className="text-xs text-muted">
                      {r.payment?.method === "CARD_TRANSFER" && r.payment.provider_payload?.payer_card_last4 ? `${t("refund.inbox.card", { last4: r.payment.provider_payload.payer_card_last4 })} · ` : ""}
                      {r.reason ?? ""} · {formatDateTime(r.created_at, undefined, locale)}
                    </div>
                  </div>
                  <div className="font-display text-2xl font-bold">{money(r.amount)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input className="min-w-48 flex-1" value={refs[r.id] ?? ""} onChange={(e) => setRefs((x) => ({ ...x, [r.id]: e.target.value }))} placeholder={t("refund.inbox.referencePh")} maxLength={120} />
                  <Button
                    loading={busy === `f-${r.id}`}
                    onClick={() =>
                      run(`f-${r.id}`, () => session.post(`/refunds/${r.id}/complete`, refs[r.id]?.trim() ? { reference: refs[r.id].trim() } : {}, { "Idempotency-Key": idemKey() }), t("refund.inbox.done"))
                    }
                  >
                    {t("refund.inbox.complete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </Card>
  );
}
