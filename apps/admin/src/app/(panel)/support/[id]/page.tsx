"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { LoadState } from "@/components/status";
import { MessageThread, ReplyBox, type SupportTicketDetail, TicketStatusBadge } from "@/components/support";
import { Card, Heading } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { useApi } from "@/lib/use-api";

export default function StaffTicketPage() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const ticket = useApi<SupportTicketDetail>(`/support/tickets/${id}`);
  const tk = ticket.data;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/support" className="text-sm text-muted hover:text-fg">
        ← {t("support.back")}
      </Link>
      <LoadState loading={ticket.loading} error={ticket.error} onRetry={ticket.reload} />
      {tk && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">{t(`support.type.${tk.type}` as MessageKey)}</span>
              <TicketStatusBadge status={tk.status} />
              {tk.club_name && <span className="text-xs text-muted">· {tk.club_name}</span>}
            </div>
            <Heading className="break-words">{tk.subject}</Heading>
          </div>
          <MessageThread ticket={tk} viewer="author" />
          <Card>{tk.can_reply ? <ReplyBox ticketId={tk.id} onSent={ticket.setData} /> : <p className="text-center text-sm text-muted">{t("support.closedNote")}</p>}</Card>
        </>
      )}
    </div>
  );
}
