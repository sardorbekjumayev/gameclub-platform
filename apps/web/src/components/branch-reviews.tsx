"use client";

import { formatDateTime } from "@gc/types";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { Review } from "@/lib/types";

const LIMIT = 10;

/** Filial sharhlari (GET /branches/:id/reviews, sahifalangan) + klub javobi + shikoyat. */
export function BranchReviews({ branchId, timezone }: { branchId: string; timezone: string }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { me } = useAuth();
  const [items, setItems] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const load = useCallback(
    async (p: number, initial = false) => {
      if (!initial) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await session.get<Review[]>(`/branches/${branchId}/reviews?limit=${LIMIT}&page=${p}`);
        setItems((prev) => (p === 1 ? res.data : [...prev, ...res.data]));
        setTotal((res.meta as { total?: number } | null)?.total ?? 0);
        setPage(p);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [branchId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    void Promise.resolve().then(() => load(1, true));
  }, [load]);

  async function report(id: string) {
    if (!confirm(t("reviews.confirmReport"))) return;
    setMsg(null);
    try {
      await session.post(`/reviews/${id}/report`, {});
      setReported((s) => new Set(s).add(id));
      setMsg({ tone: "success", text: t("reviews.reported") });
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    }
  }

  return (
    <Card className="space-y-3">
      <div className="font-display text-lg font-bold">{t("branch.reviews")}</div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {error && (
        <Alert>
          {error}{" "}
          <button className="underline" onClick={() => load(page)}>
            {t("map.retry")}
          </button>
        </Alert>
      )}
      {!loading && !error && items.length === 0 && <div className="text-sm text-muted">{t("branch.noReviews")}</div>}
      {items.map((r) => (
        <div key={r.id} className="space-y-1 border-b border-line-soft pb-3 last:border-0">
          <div className="flex justify-between text-sm">
            <span className="font-bold">{r.author ?? t("branch.anonymous")}</span>
            <span className="text-accent" aria-label={t("reviews.ratingN", { n: r.rating })}>
              {"★".repeat(r.rating)}
            </span>
          </div>
          {r.text && <p className="whitespace-pre-line text-sm">{r.text}</p>}
          {r.reply_text && <p className="rounded-lg bg-surface-2 p-2 text-xs text-muted">{t("branch.clubReply", { text: r.reply_text })}</p>}
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{formatDateTime(r.created_at, timezone, locale)}</span>
            {me &&
              (reported.has(r.id) ? (
                <span>{t("reviews.reported")}</span>
              ) : (
                <button type="button" className="hover:text-danger-soft hover:underline" onClick={() => report(r.id)}>
                  {t("reviews.report")}
                </button>
              ))}
          </div>
        </div>
      ))}
      {loading && <Spinner className="mx-auto h-5 w-5" />}
      {!loading && items.length < total && (
        <Button variant="secondary" size="sm" className="w-full" onClick={() => load(page + 1)}>
          {t("notifications.more")}
        </Button>
      )}
    </Card>
  );
}
