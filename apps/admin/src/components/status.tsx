"use client";

import { Inbox } from "lucide-react";
import { Alert, Badge, Spinner } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";

const CLUB_TONE: Record<string, "neutral" | "green" | "red" | "amber" | "violet"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "amber",
  ACTIVE: "green",
  REJECTED: "red",
  SUSPENDED: "red",
  CLOSED: "neutral",
  INACTIVE: "neutral",
  PENDING: "amber",
  ACCEPTED: "green",
  REVOKED: "neutral",
  EXPIRED: "neutral",
  APPROVED: "green",
  MAINTENANCE: "amber",
  DISABLED: "red",
  OPEN: "amber",
  IN_PROGRESS: "violet",
  DONE: "green",
  TRIALING: "violet",
  PAST_DUE: "amber",
  CANCELLED: "neutral",
};

/** Klub/filial/taklif holati uchun badge; matn i18n `status.*` kalitidan. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const key = `status.${status}` as MessageKey;
  return <Badge tone={CLUB_TONE[status] ?? "neutral"}>{t(key) === key ? status : t(key)}</Badge>;
}

/** Sahifa darajasidagi loading/error holati. */
export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry?: () => void }) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <Alert>
        {error}{" "}
        {onRetry && (
          <button className="underline" onClick={onRetry}>
            {t("common.retry")}
          </button>
        )}
      </Alert>
    );
  }
  return null;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[18px] border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Inbox className="h-6 w-6" />
      </span>
      {children}
    </div>
  );
}
