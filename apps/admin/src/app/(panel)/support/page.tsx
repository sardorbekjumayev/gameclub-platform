"use client";

import { formatDateTime } from "@gc/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Empty, LoadState } from "@/components/status";
import { NewTicketForm, type SupportTicket, TicketStatusBadge } from "@/components/support";
import { Badge, Card, Heading } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { useCurrentClub } from "@/lib/current-club";
import { useApi } from "@/lib/use-api";

/** Klub egasi / admin / operator: platformaga talab va taklif yuborish va javoblarni ko'rish. */
export default function StaffSupportPage() {
  const { t } = useI18n();
  const router = useRouter();
  const current = useCurrentClub();
  const tickets = useApi<SupportTicket[]>("/support/tickets?limit=50");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Heading>{t("support.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("support.subtitle")}</p>
      </div>
      <Card>
        <h2 className="mb-4 font-display text-lg font-bold">{t("support.new")}</h2>
        <NewTicketForm clubId={current.club?.id} onCreated={(tk) => router.push(`/support/${tk.id}`)} />
      </Card>
      <h2 className="pt-2 font-display text-lg font-bold">{t("support.mine")}</h2>
      <LoadState loading={tickets.loading} error={tickets.error} onRetry={tickets.reload} />
      {tickets.data?.length === 0 && <Empty>{t("support.empty")}</Empty>}
      <ul className="space-y-2">
        {tickets.data?.map((tk) => (
          <li key={tk.id}>
            <Link href={`/support/${tk.id}`} className="block rounded-2xl border border-line bg-surface p-4 transition hover:border-muted/60">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted">{t(`support.type.${tk.type}` as MessageKey)}</span>
                <TicketStatusBadge status={tk.status} />
                {(tk.status === "OPEN" || tk.status === "IN_PROGRESS") &&
                  (tk.awaiting_reply ? <Badge>{t("support.waiting")}</Badge> : <Badge tone="green">{t("support.replied")}</Badge>)}
                <span className="ml-auto text-xs text-muted">{formatDateTime(tk.last_message_at)}</span>
              </div>
              <div className="mt-1.5 truncate font-semibold">{tk.subject}</div>
              {tk._count && <div className="mt-0.5 text-xs text-muted">{t("support.messages", { n: tk._count.messages })}</div>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
