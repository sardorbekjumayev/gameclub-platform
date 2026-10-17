"use client";

import { useState } from "react";
import { LoadState } from "@/components/status";
import { Alert, Button, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { Branch, WorkingHours } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];
type Win = { open: string; close: string };
type Exception = { id: string; date: string; is_closed: boolean; open_time: string | null; close_time: string | null; reason: string | null };

/** Filial ish vaqti (haftalik oynalar + 24/7) va istisno kunlar muharriri. API: PATCH /branches/:id + /hours-exceptions. */
export function BranchHours({ branch, onSaved }: { branch: Branch; onSaved?: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const editable = can("branches.update");
  const wh = (branch.working_hours ?? {}) as WorkingHours;
  const [always, setAlways] = useState(!!wh.always_open);
  const [days, setDays] = useState<Record<Day, Win[]>>(
    () => Object.fromEntries(DAYS.map((d) => [d, (wh[d] ?? []).map((w) => ({ open: w.open, close: w.close }))])) as Record<Day, Win[]>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setDay = (d: Day, wins: Win[]) => setDays((s) => ({ ...s, [d]: wins }));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const working_hours: WorkingHours = always ? { always_open: true } : Object.fromEntries(DAYS.map((d) => [d, days[d]]));
    try {
      await session.patch(`/branches/${branch.id}`, { working_hours });
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-line-soft pt-3">
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">{t("common.saved")}</Alert>}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={always} disabled={!editable} onChange={(e) => setAlways(e.target.checked)} />
        {t("hours.alwaysOpen")}
      </label>

      {!always && (
        <div className="space-y-2">
          {DAYS.map((d) => (
            <div key={d} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-sm font-bold">{t(`day.${d}` as never)}</span>
              {days[d].length === 0 && <span className="text-xs text-muted">{t("hours.closed")}</span>}
              {days[d].map((w, i) => (
                <span key={i} className="flex items-center gap-1">
                  <Input
                    type="time"
                    className="max-w-28"
                    value={w.open}
                    disabled={!editable}
                    onChange={(e) => setDay(d, days[d].map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                  />
                  <span>–</span>
                  <Input
                    type="time"
                    className="max-w-28"
                    value={w.close}
                    disabled={!editable}
                    onChange={(e) => setDay(d, days[d].map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                  />
                  {editable && (
                    <button type="button" className="text-xs text-danger-soft hover:underline" onClick={() => setDay(d, days[d].filter((_, j) => j !== i))}>
                      {t("common.delete")}
                    </button>
                  )}
                </span>
              ))}
              {editable && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setDay(d, [...days[d], { open: "10:00", close: "22:00" }])}>
                  + {t("hours.addWindow")}
                </button>
              )}
            </div>
          ))}
          <div className="text-xs text-muted">{t("hours.overnightHint")}</div>
        </div>
      )}

      {editable && (
        <Button size="sm" loading={busy} onClick={save}>
          {t("common.save")}
        </Button>
      )}

      <Exceptions branchId={branch.id} editable={editable} />
    </div>
  );
}

/** Bayram / yopiq kun istisnolari (sana bo'yicha). */
function Exceptions({ branchId, editable }: { branchId: string; editable: boolean }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const list = useApi<Exception[]>(`/branches/${branchId}/hours-exceptions`);
  const [date, setDate] = useState("");
  const [closed, setClosed] = useState(true);
  const [open, setOpen] = useState("10:00");
  const [close, setClose] = useState("22:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.post(`/branches/${branchId}/hours-exceptions`, {
        date,
        is_closed: closed,
        ...(closed ? {} : { open_time: open, close_time: close }),
        ...(reason ? { reason } : {}),
      });
      setDate("");
      setReason("");
      list.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    try {
      await session.delete(`/branches/${branchId}/hours-exceptions/${id}`);
      list.reload();
    } catch (err) {
      alert(errorText(err));
    }
  }

  return (
    <div className="space-y-2 border-t border-line-soft pt-3">
      <div className="text-sm font-bold">{t("hours.exceptions")}</div>
      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.data?.length === 0 && <div className="text-xs text-muted">{t("hours.noExceptions")}</div>}
      <ul className="space-y-1">
        {list.data?.map((ex) => (
          <li key={ex.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span>
              {ex.date.slice(0, 10)} · {ex.is_closed ? t("hours.closed") : `${ex.open_time ?? ""}–${ex.close_time ?? ""}`}
              {ex.reason ? ` · ${ex.reason}` : ""}
            </span>
            {editable && (
              <button className="text-xs text-danger-soft hover:underline" onClick={() => confirm(t("hours.confirmDeleteException")) && del(ex.id)}>
                {t("common.delete")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={add}>
          {error && <Alert>{error}</Alert>}
          <Input type="date" className="max-w-40" value={date} onChange={(e) => setDate(e.target.value)} required />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            {t("hours.closedDay")}
          </label>
          {!closed && (
            <>
              <Input type="time" className="max-w-28" value={open} onChange={(e) => setOpen(e.target.value)} />
              <span>–</span>
              <Input type="time" className="max-w-28" value={close} onChange={(e) => setClose(e.target.value)} />
            </>
          )}
          <Input className="max-w-52" placeholder={t("hours.reason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
          <Button type="submit" size="sm" variant="secondary" loading={busy}>
            {t("common.add")}
          </Button>
        </form>
      )}
    </div>
  );
}
