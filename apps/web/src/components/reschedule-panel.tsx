"use client";

import { useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Spinner, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime, tzDate } from "@/lib/format";
import { session } from "@/lib/session";
import type { BookingDetail, Slots } from "@/lib/types";
import { useApi, useSubmitKey } from "@/lib/use-api";

/**
 * Bronni ko'chirish (POST /bookings/:id/reschedule): yangi sana + boshlanish vaqti.
 * Qurilmalar va davomiylik o'zgarmaydi; slotlar GET /branches/:id/slots dan. Qoidalarni server tekshiradi.
 */
export function ReschedulePanel({ booking, onDone, onClose }: { booking: BookingDetail; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const tz = booking.branch.timezone;
  const maxDays = Math.min((booking.branch as { booking_settings?: { max_advance_days?: number } }).booking_settings?.max_advance_days || 7, 14);
  const dates = useMemo(() => Array.from({ length: maxDays + 1 }, (_, i) => tzDate(i, tz)), [maxDays, tz]);
  const [date, setDate] = useState(dates[0]);
  const [start, setStart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const submitKey = useSubmitKey();
  const [error, setError] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const slots = useApi<Slots>(`/branches/${booking.branch.id}/slots?date=${date}&duration=${booking.duration_minutes}&exclude_booking_id=${booking.id}`);
  // Faqat bronning barcha qurilmalari bo'sh bo'lgan slotlar ko'chirishga yaraydi
  const need = booking.items.length;
  const future = (slots.data?.slots ?? []).filter((s) => new Date(s.start_at).getTime() >= openedAt && s.start_at !== booking.start_at && s.available_count === need);

  async function submit() {
    if (!start) return;
    // Ikki marta bosish: `busy` keyingi render'gacha yangilanmaydi — ref darhol to'sadi
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = { start_at: start };
      await session.post(`/bookings/${booking.id}/reschedule`, body, { "Idempotency-Key": submitKey(body) });
      onDone();
    } catch (e) {
      setError(errorText(e));
      if ((e as { code?: string }).code === "BOOKING_SLOT_TAKEN") slots.reload();
      setBusy(false);
      submitting.current = false;
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-display text-lg font-bold">{t("booking.reschedule.title")}</div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("booking.reschedule.close")}
        </Button>
      </div>
      <p className="text-xs text-muted">{t("booking.reschedule.hint")}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {dates.map((d, i) => (
          <button
            key={d}
            onClick={() => {
              setDate(d);
              setStart(null);
              setError(null);
            }}
            className={cx("h-14 min-w-[64px] shrink-0 rounded-xl px-2 text-center text-xs font-bold", d === date ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}
          >
            {i === 0 ? t("book.today") : i === 1 ? t("book.tomorrow") : fmtDate(`${d}T12:00:00+05:00`, t, tz)}
          </button>
        ))}
      </div>
      {slots.loading ? (
        <Spinner className="mx-auto h-5 w-5" />
      ) : slots.error ? (
        <Alert>{slots.error}</Alert>
      ) : future.length === 0 ? (
        <div className="text-sm text-muted">{t("book.noSlots")}</div>
      ) : (
        <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto pr-1">
          {future.map((s) => (
            <button
              key={s.start_at}
              onClick={() => setStart(s.start_at)}
              className={cx("h-10 rounded-xl text-sm font-bold tabular-nums disabled:cursor-not-allowed disabled:opacity-30", s.start_at === start ? "bg-accent text-on-accent" : "border border-line bg-surface-2")}
            >
              {fmtTime(s.start_at, tz)}
            </button>
          ))}
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      <Button className="w-full" disabled={!start} loading={busy} onClick={submit}>
        {start ? t("booking.reschedule.confirm", { when: `${fmtDate(start, t, tz)}, ${fmtTime(start, tz)}` }) : t("booking.reschedule.pick")}
      </Button>
    </Card>
  );
}
