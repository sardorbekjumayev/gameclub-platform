"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/require-auth";
import { Alert, Card, Heading, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtDate } from "@/lib/format";
import type { MyReview } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function ReviewsPage() {
  return (
    <RequireAuth>
      <MyReviews />
    </RequireAuth>
  );
}

function MyReviews() {
  const { t } = useI18n();
  const reviews = useApi<MyReview[]>("/reviews/mine");
  const list = reviews.data ?? [];

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-5 px-4 py-8">
      <Link href="/profile" className="text-sm text-muted hover:text-fg">
        ← {t("profile.title")}
      </Link>
      <Heading>{t("reviews.mine.title")}</Heading>
      {reviews.loading ? (
        <Spinner className="mx-auto my-12 h-6 w-6" />
      ) : reviews.error ? (
        <Alert>{reviews.error}</Alert>
      ) : list.length === 0 ? (
        <Card className="text-center text-sm text-muted">{t("reviews.mine.empty")}</Card>
      ) : (
        list.map((r) => (
          <Card key={r.id} className="space-y-2">
            <div className="font-display font-bold">
              {r.club_name} <span className="text-sm font-normal text-muted">· {r.branch_name}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-accent" aria-label={t("reviews.mine.rating", { n: r.rating })}>
                {"★".repeat(r.rating)}
                <span className="text-muted">{"★".repeat(Math.max(0, 5 - r.rating))}</span>
              </span>
              <span className="text-xs text-muted">{fmtDate(r.created_at, t)}</span>
            </div>
            {r.text && <p className="text-sm">{r.text}</p>}
            {r.status !== "VISIBLE" && <p className="text-xs text-muted">{t("reviews.mine.hidden")}</p>}
            {r.reply_text && (
              <div className="rounded-xl bg-surface-2 p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-muted">{t("reviews.mine.reply")}</div>
                {r.reply_text}
              </div>
            )}
            <Link href={`/bookings/${r.booking_id}`} className="inline-block text-sm font-semibold text-accent hover:underline">
              {t("reviews.mine.booking")} →
            </Link>
          </Card>
        ))
      )}
    </main>
  );
}
