"use client";

import { formatDateTime } from "@gc/types";
import { useState } from "react";
import { Pager, Stars } from "@/components/analytics";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Badge, Button, Card, Chip, Heading, Input } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import type { Review } from "@/lib/analytics-types";
import { session } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const LIMIT = 20;
const FILTERS = ["", "PENDING_MODERATION", "VISIBLE", "HIDDEN"] as const;

export default function PlatformReviewsPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("PENDING_MODERATION");
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const r = useApi<Review[]>(`/admin/reviews?page=${page}&limit=${LIMIT}${status ? `&status=${status}` : ""}`);

  async function moderate(id: string, next: "VISIBLE" | "HIDDEN") {
    setBusy(id + next);
    setMsg(null);
    try {
      await session.patch(`/admin/reviews/${id}`, { status: next, ...(notes[id]?.trim() ? { note: notes[id].trim() } : {}) });
      setMsg({ tone: "success", text: t("common.saved") });
      r.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Heading>{t("moderation.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("moderation.subtitle")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip
            key={f}
            active={status === f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
          >
            {f ? t(`status.${f}` as MessageKey) : t("moderation.all")}
          </Chip>
        ))}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      {r.data?.length === 0 && <Empty>{t("review.empty")}</Empty>}
      <div className="space-y-3">
        {r.data?.map((rev) => (
          <Card key={rev.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Stars rating={rev.rating} />
                <span className="font-semibold">{rev.club_name ?? "—"}</span>
                <span className="text-xs text-muted">· {rev.author ?? t("review.anonymous")}</span>
                <StatusBadge status={rev.status} />
                {rev.reported_count > 0 && <Badge tone="red">{t("moderation.reports", { n: rev.reported_count })}</Badge>}
              </div>
              <span className="text-xs text-muted">{formatDateTime(rev.created_at)}</span>
            </div>
            {rev.text ? <p className="whitespace-pre-line text-sm">{rev.text}</p> : <p className="text-sm italic text-muted">{t("review.noText")}</p>}
            {rev.reply_text && (
              <div className="rounded-xl border-l-2 border-accent bg-surface-2 px-4 py-3 text-sm">
                <div className="mb-1 text-xs font-bold text-muted">{t("review.reply")}</div>
                <p className="whitespace-pre-line">{rev.reply_text}</p>
              </div>
            )}
            {rev.moderation_note && <p className="text-xs text-muted">{t("moderation.noteShown", { note: rev.moderation_note })}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-9 max-w-sm text-sm" placeholder={t("moderation.note")} maxLength={500} value={notes[rev.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [rev.id]: e.target.value }))} />
              {rev.status !== "VISIBLE" && (
                <Button size="sm" loading={busy === rev.id + "VISIBLE"} onClick={() => moderate(rev.id, "VISIBLE")}>
                  {t("moderation.show")}
                </Button>
              )}
              {rev.status !== "HIDDEN" && (
                <Button size="sm" variant="danger" loading={busy === rev.id + "HIDDEN"} onClick={() => moderate(rev.id, "HIDDEN")}>
                  {t("moderation.hide")}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      <Pager page={page} total={r.meta?.total ?? 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}
