"use client";

import { formatDateTime, formatMoney, parseSom } from "@gc/types";
import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { ShiftReport } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Modal } from "./device-panel";

/** Kassa smenasi (docs/01-API.md §6.10): ochish → hisobot → yopish (sanalgan naqd bilan). */
export function ShiftPanel({ branchId, shiftId, onClose, onChanged }: { branchId: string; shiftId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const report = useApi<ShiftReport>(shiftId ? `/shifts/${shiftId}/report` : null);
  const [cash, setCash] = useState("");
  const [note, setNote] = useState("");
  const [closed, setClosed] = useState<ShiftReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseSom(cash || "0");
    if (amount === null) {
      setError(t("tariff.badPrice"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (shiftId) {
        const res = await session.post<ShiftReport>(`/shifts/${shiftId}/close`, { counted_cash: amount, ...(note.trim() && { note: note.trim() }) });
        setClosed(res.data);
      } else {
        await session.post("/shifts/open", { branch_id: branchId, opening_cash: amount });
        onClose();
      }
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const r = closed ?? report.data;

  return (
    <Modal title={shiftId ? t("shift.title") : t("shift.open")} onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {!shiftId && <p className="text-sm text-muted">{t("shift.openHint")}</p>}
        {shiftId && report.loading && <div className="text-sm text-muted">{t("common.loading")}</div>}
        {r && (
          <div className="space-y-1 rounded-xl bg-surface-2 p-4 text-sm">
            <Row label={t("shift.openedAt")} value={formatDateTime(r.opened_at, undefined, locale)} />
            <Row label={t("shift.openingCash")} value={formatMoney(r.opening_cash, locale)} />
            <Row label={t("shift.cashIn")} value={formatMoney(r.totals.cash_in, locale)} />
            <Row label={t("shift.terminalIn")} value={formatMoney(r.totals.terminal_in, locale)} />
            <Row label={t("shift.cashRefunds")} value={`−${formatMoney(r.totals.cash_refunds, locale)}`} />
            <Row label={t("shift.paymentsCount")} value={String(r.totals.payments_count)} />
            <div className="flex justify-between border-t border-line-soft pt-2 font-bold">
              <span>{t("shift.expectedCash")}</span>
              <span className="tabular-nums">{formatMoney(r.totals.expected_cash, locale)}</span>
            </div>
            {r.status === "CLOSED" && r.closing_cash_counted !== null && (
              <>
                <Row label={t("shift.counted")} value={formatMoney(r.closing_cash_counted, locale)} />
                <div className={`flex justify-between font-bold ${r.difference ? "text-danger-soft" : "text-accent"}`}>
                  <span>{t("shift.difference")}</span>
                  <span className="tabular-nums">{formatMoney(r.difference ?? 0, locale)}</span>
                </div>
              </>
            )}
          </div>
        )}
        {closed ? (
          <Button className="w-full" onClick={onClose}>
            {t("shift.done")}
          </Button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label={shiftId ? t("shift.countedCash") : t("shift.openingCash")} hint={t("tariff.somHint")}>
              <Input inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" autoFocus />
            </Field>
            {shiftId && (
              <Field label={t("shift.note")}>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </Field>
            )}
            <Button type="submit" size="lg" variant={shiftId ? "danger" : "primary"} className="w-full" loading={busy}>
              {shiftId ? t("shift.close") : t("shift.open")}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
