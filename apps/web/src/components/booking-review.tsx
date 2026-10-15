"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { BookingDetail } from "@/lib/types";
import { useSubmitKey } from "@/lib/use-api";

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-1" role={onChange ? "radiogroup" : undefined} aria-label={t("reviews.rating")}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t("reviews.ratingN", { n })}
            onClick={() => onChange(n)}
            className={cx("text-3xl leading-none transition", n <= value ? "text-accent" : "text-line hover:text-muted")}
          >
            ★
          </button>
        ) : (
          <span key={n} className={cx("text-xl leading-none", n <= value ? "text-accent" : "text-line")} aria-hidden>
            ★
          </span>
        ),
      )}
    </div>
  );
}

/** Tugagan bron uchun sharh: yozish / ko'rish / tahrirlash / o'chirish (POST|PATCH|DELETE /reviews). */
export function BookingReview({ booking, onChange }: { booking: BookingDetail; onChange: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const review = booking.review;
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [text, setText] = useState(review?.text ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const saving = useRef(false);
  const submitKey = useSubmitKey();
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  if (!review && !booking.can_review) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) return setMsg({ tone: "error", text: t("reviews.pickRating") });
    // Ikki marta bosish: `busy` keyingi render'gacha yangilanmaydi — ref darhol to'sadi
    if (saving.current) return;
    saving.current = true;
    setBusy("save");
    setMsg(null);
    try {
      const body = { rating, text: text.trim() || undefined };
      if (review) await session.patch(`/reviews/${review.id}`, { ...body, text: text.trim() });
      else {
        const create = { booking_id: booking.id, ...body };
        await session.post("/reviews", create, { "Idempotency-Key": submitKey(create) });
      }
      setEditing(false);
      setMsg({ tone: "success", text: t("reviews.saved") });
      onChange();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
      saving.current = false;
    }
  }

  async function remove() {
    if (!review || !confirm(t("reviews.confirmDelete"))) return;
    setBusy("delete");
    setMsg(null);
    try {
      await session.delete(`/reviews/${review.id}`);
      setRating(0);
      setText("");
      setMsg({ tone: "success", text: t("reviews.deleted") });
      onChange();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const showForm = !review || editing;

  return (
    <Card className="space-y-3">
      <div className="font-display text-lg font-bold">{review ? t("reviews.yours") : t("reviews.leave")}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {showForm ? (
        <form className="space-y-3" onSubmit={submit}>
          <Stars value={rating} onChange={setRating} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder={t("reviews.textPlaceholder")}
            className="w-full rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px] text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <div className="flex gap-2">
            <Button type="submit" loading={busy === "save"} disabled={rating < 1}>
              {review ? t("common.save") : t("reviews.submit")}
            </Button>
            {review && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setRating(review.rating);
                  setText(review.text ?? "");
                }}
              >
                {t("reviews.cancel")}
              </Button>
            )}
          </div>
        </form>
      ) : (
        review && (
          <div className="space-y-2">
            <Stars value={review.rating} />
            {review.text && <p className="whitespace-pre-line text-sm">{review.text}</p>}
            {review.reply_text && <p className="rounded-lg bg-surface-2 p-2 text-xs text-muted">{t("branch.clubReply", { text: review.reply_text })}</p>}
            <div className="flex gap-2">
              {review.can_edit && (
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  {t("reviews.edit")}
                </Button>
              )}
              <Button variant="danger" size="sm" loading={busy === "delete"} onClick={remove}>
                {t("reviews.delete")}
              </Button>
            </div>
            {review.can_edit && <p className="text-xs text-muted">{t("reviews.editHint")}</p>}
          </div>
        )
      )}
    </Card>
  );
}
