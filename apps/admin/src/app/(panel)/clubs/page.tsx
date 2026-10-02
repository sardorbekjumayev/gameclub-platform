"use client";

import Link from "next/link";
import { firstClubTab } from "@/components/club-tabs";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Button, Card, Heading } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { isPlatformStaff } from "@/lib/panel";
import { useAuth } from "@/lib/session";
import type { MyClub } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function ClubsPage() {
  const { t } = useI18n();
  const { can, me } = useAuth();
  const { data, loading, error, reload } = useApi<MyClub[]>("/clubs/mine");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading>{t("clubs.title")}</Heading>
        {!isPlatformStaff(me) && (can("clubs.update") || data?.length === 0) ? (
          <Link href="/clubs/new">
            <Button>{t("clubs.new")}</Button>
          </Link>
        ) : null}
      </div>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {data && data.length === 0 && <Empty>{t("clubs.empty")}</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((c) => (
          <Link key={c.id} href={firstClubTab(c.id, can)}>
            <Card className="h-full space-y-3 transition hover:bg-surface-2">
              <div className="flex items-start justify-between gap-2">
                <div className="font-display text-lg font-bold">{c.name}</div>
                <StatusBadge status={c.status} />
              </div>
              <div className="text-sm text-muted">{t("clubs.branchesCount", { count: c.branches.length })}</div>
              {c.my_roles.length > 0 && <div className="text-xs text-muted">{[...new Set(c.my_roles.map((r) => t(`role.${r.role}` as never)))].join(", ")}</div>}
              {c.status === "REJECTED" && c.rejection_reason && <div className="text-sm text-danger-soft">{c.rejection_reason}</div>}
              {c.status === "SUSPENDED" && c.suspended_reason && <div className="text-sm text-danger-soft">{c.suspended_reason}</div>}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
