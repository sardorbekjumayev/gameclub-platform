"use client";

import { formatDateTime, formatMoney } from "@gc/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Button, Card, Heading, Input, Stat } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import { AssignPlan } from "@/components/assign-plan";
import { SubscriptionCard } from "@/components/subscription-card";
import type { Club, ClubSubscription } from "@/lib/types";
import { useApi } from "@/lib/use-api";

type Action = "approve" | "reject" | "suspend" | "reactivate" | "close";

/** Holat → ruxsat etilgan amallar (API state machine bilan mos). */
const ACTIONS: Record<string, Action[]> = {
  PENDING_APPROVAL: ["approve", "reject"],
  ACTIVE: ["suspend", "close"],
  SUSPENDED: ["reactivate", "close"],
  REJECTED: [],
  DRAFT: [],
  CLOSED: [],
};
const NEEDS_REASON: Action[] = ["reject", "suspend", "close"];

export default function AdminClubPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const club = useApi<Club>(`/admin/clubs/${id}`);
  const sub = useApi<ClubSubscription>(`/clubs/${id}/subscription`);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: t("common.saved") });
      club.reload();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const transition = (a: Action) => {
    if (NEEDS_REASON.includes(a) && !reason.trim()) {
      setMsg({ tone: "error", text: t("approvals.reasonRequired") });
      return;
    }
    if (a === "close" && !confirm(t("approvals.confirmClose"))) return;
    run(a, async () => {
      await session.post(`/admin/clubs/${id}/${a}`, reason.trim() ? { reason: reason.trim() } : {});
      setReason("");
    });
  };

  const c = club.data;
  const actions = (c ? ACTIONS[c.status] ?? [] : []).filter((a) => (a === "approve" || a === "reject" ? can("platform.clubs.approve") : can("platform.clubs.suspend")));

  return (
    <div className="space-y-5">
      <Link href="/platform/clubs" className="text-sm text-muted hover:text-fg">
        ← {t("approvals.title")}
      </Link>
      <LoadState loading={club.loading && !c} error={club.error} onRetry={club.reload} />
      {c && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Heading>{c.name}</Heading>
            <StatusBadge status={c.status} />
          </div>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          {c.rejection_reason && c.status === "REJECTED" && <Alert>{t("club.rejectedReason", { reason: c.rejection_reason })}</Alert>}
          {c.suspended_reason && c.status === "SUSPENDED" && <Alert>{t("club.suspendedReason", { reason: c.suspended_reason })}</Alert>}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t("club.tab.branches")} value={c.branches?.length ?? 0} />
            <Stat label={t("approvals.bookings")} value={c.stats?.bookings ?? 0} />
            <Stat label={t("approvals.gmv")} value={formatMoney(Number(c.stats?.gmv ?? 0), locale)} accent />
          </div>

          {actions.length > 0 && (
            <Card className="space-y-3">
              <div className="font-display text-lg font-bold">{t("approvals.decision")}</div>
              <Input placeholder={t("approvals.reason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button key={a} variant={a === "approve" || a === "reactivate" ? "primary" : "danger"} loading={busy === a} onClick={() => transition(a)}>
                    {t(`approvals.action.${a}` as never)}
                  </Button>
                ))}
              </div>
            </Card>
          )}

          {sub.data && (
            <SubscriptionCard data={sub.data}>
              {can("platform.subscriptions.manage") && <AssignPlan clubId={c.id} currentPlanId={sub.data.subscription?.plan.id ?? null} onDone={sub.reload} />}
            </SubscriptionCard>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2 text-sm">
              <div className="font-display text-lg font-bold">{t("approvals.info")}</div>
              <Row label={t("approvals.owner")} value={[c.owner?.first_name, c.owner?.last_name].filter(Boolean).join(" ") || c.owner?.phone || "—"} />
              <Row label={t("club.phone")} value={c.phone} />
              <Row label="Telegram" value={c.telegram} />
              <Row label="Instagram" value={c.instagram} />
              <Row label={t("club.website")} value={c.website} />
              <Row label={t("users.col.created")} value={formatDateTime(c.created_at, undefined, locale)} />
              {c.description && <p className="whitespace-pre-line pt-2 text-muted">{c.description}</p>}
            </Card>
            <Card className="space-y-3">
              <div className="font-display text-lg font-bold">{t("club.tab.branches")}</div>
              {c.branches?.length === 0 && <Empty>{t("branch.empty")}</Empty>}
              <ul className="space-y-2 text-sm">
                {c.branches?.map((b) => (
                  <li key={b.id} className="rounded-xl bg-surface-2 px-4 py-3">
                    <div className="flex items-center gap-2 font-bold">
                      {b.name} <StatusBadge status={b.status} />
                    </div>
                    <div className="text-muted">{b.address}</div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="space-y-3">
            <div className="font-display text-lg font-bold">{t("club.documents")}</div>
            {c.documents?.length === 0 && <Empty>{t("club.documentsEmpty")}</Empty>}
            <ul className="space-y-2">
              {c.documents?.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
                  <div>
                    <div className="font-bold">{t(`doc.${d.type}` as never)}</div>
                    {d.file_url && (
                      <a href={d.file_url} target="_blank" rel="noreferrer" className="break-all text-xs text-accent underline">
                        {d.file_id ? t("upload.open") : d.file_url}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={d.status} />
                    {d.status === "PENDING" && (
                      <>
                        <Button size="sm" loading={busy === `doc-a-${d.id}`} onClick={() => run(`doc-a-${d.id}`, async () => void (await session.patch(`/admin/clubs/documents/${d.id}`, { status: "APPROVED" })))}>
                          {t("approvals.action.approve")}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={busy === `doc-r-${d.id}`}
                          onClick={() => run(`doc-r-${d.id}`, async () => void (await session.patch(`/admin/clubs/documents/${d.id}`, { status: "REJECTED", ...(reason.trim() && { note: reason.trim() }) })))}
                        >
                          {t("approvals.action.reject")}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line-soft py-1.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold">{value || "—"}</span>
    </div>
  );
}
