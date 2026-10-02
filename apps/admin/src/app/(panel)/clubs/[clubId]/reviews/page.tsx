"use client";

import { formatDateTime } from "@gc/types";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Pager, Stars } from "@/components/analytics";
import { ClubHeader } from "@/components/club-tabs";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Button, Card, Chip, Select } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import type { Review } from "@/lib/analytics-types";
import { useMyClub } from "@/lib/my-club";
import { session, useAuth } from "@/lib/session";
import { idemKey, useApi } from "@/lib/use-api";

const LIMIT = 20;

export default function ClubReviewsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { can } = useAuth();
  const { branches } = useMyClub(clubId);
  const [branchId, setBranchId] = useState("");
  const [unanswered, setUnanswered] = useState(false);
  const [page, setPage] = useState(1);
  const r = useApi<Review[]>(`/clubs/${clubId}/reviews?page=${page}&limit=${LIMIT}${branchId ? `&branch_id=${branchId}` : ""}${unanswered ? "&unanswered=true" : ""}`);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name;

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      <div className="flex flex-wrap items-center gap-3">
        {branches.length > 1 && (
          <Select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("analytics.allBranches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
        <Chip
          active={unanswered}
          onClick={() => {
            setUnanswered((v) => !v);
            setPage(1);
          }}
        >
          {t("review.unanswered")}
        </Chip>
      </div>
      <LoadState loading={r.loading} error={r.error} onRetry={r.reload} />
      {r.data?.length === 0 && <Empty>{t("review.empty")}</Empty>}
      <div className="space-y-3">
        {r.data?.map((rev) => (
          <Card key={rev.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Stars rating={rev.rating} />
                <span className="font-semibold">{rev.author ?? t("review.anonymous")}</span>
                {branchName(rev.branch_id) && <span className="text-xs text-muted">· {branchName(rev.branch_id)}</span>}
                {rev.status !== "VISIBLE" && <StatusBadge status={rev.status} />}
              </div>
              <span className="text-xs text-muted">{formatDateTime(rev.created_at)}</span>
            </div>
            {rev.text ? <p className="whitespace-pre-line text-sm">{rev.text}</p> : <p className="text-sm italic text-muted">{t("review.noText")}</p>}
            {rev.reply_text ? (
              <div className="rounded-xl border-l-2 border-accent bg-surface-2 px-4 py-3 text-sm">
                <div className="mb-1 text-xs font-bold text-muted">
                  {t("review.reply")} {rev.replied_at && `· ${formatDateTime(rev.replied_at)}`}
                </div>
                <p className="whitespace-pre-line">{rev.reply_text}</p>
              </div>
            ) : (
              can("reviews.reply") && <ReplyForm id={rev.id} onDone={r.reload} />
            )}
          </Card>
        ))}
      </div>
      <Pager page={page} total={r.meta?.total ?? 0} limit={LIMIT} onPage={setPage} />
    </div>
  );
}

function ReplyForm({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await session.post(`/reviews/${id}/reply`, { text: text.trim() }, { "Idempotency-Key": idemKey() });
          onDone();
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && <Alert>{error}</Alert>}
      <textarea
        className="min-h-20 w-full rounded-[14px] border border-line bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent"
        placeholder={t("review.replyPlaceholder")}
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        required
      />
      <Button type="submit" size="sm" loading={busy} disabled={!text.trim()}>
        {t("review.sendReply")}
      </Button>
    </form>
  );
}
