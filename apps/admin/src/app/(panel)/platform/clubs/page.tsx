"use client";

import { formatDateTime } from "@gc/types";
import Link from "next/link";
import { useState } from "react";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Button, Card, Chip, Heading } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { Club } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const FILTERS = ["PENDING_APPROVAL", "ACTIVE", "DRAFT", "REJECTED", "SUSPENDED", ""] as const;
const LIMIT = 20;

/** Super admin: klub arizalari navbati (docs/01-API.md §6.1 approval). */
export default function ClubApprovalsPage() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<string>("PENDING_APPROVAL");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), ...(status && { status }) });
  const { data, meta, loading, error, reload } = useApi<Club[]>(`/admin/clubs?${params}`);
  const pages = Math.max(1, Math.ceil((meta?.total ?? 0) / LIMIT));

  return (
    <div className="space-y-4">
      <Heading>{t("approvals.title")}</Heading>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip
            key={f || "all"}
            active={status === f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
          >
            {f ? t(`status.${f}` as never) : t("approvals.all")}
          </Chip>
        ))}
      </div>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && data?.length === 0 && <Empty>{t("approvals.empty")}</Empty>}
      {!loading && !!data?.length && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line-soft text-xs font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">{t("club.name")}</th>
                <th className="px-4 py-3">{t("approvals.owner")}</th>
                <th className="px-4 py-3">{t("club.tab.branches")}</th>
                <th className="px-4 py-3">{t("club.documents")}</th>
                <th className="px-4 py-3">{t("users.col.status")}</th>
                <th className="px-4 py-3">{t("users.col.created")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-line-soft transition last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3 font-bold">
                    <Link href={`/platform/clubs/${c.id}`} className="hover:text-accent">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.owner?.phone ?? c.owner?.email ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{c._count?.branches ?? 0}</td>
                  <td className="px-4 py-3 tabular-nums">{c._count?.documents ?? 0}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(c.created_at, undefined, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{t("common.page", { page, pages })}</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("common.prev")}
          </Button>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
