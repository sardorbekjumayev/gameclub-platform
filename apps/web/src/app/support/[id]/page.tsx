"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { MessageThread, TicketStatusBadge, textarea } from "@/components/support";
import { Alert, Button, Card, Heading, Spinner } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { SupportTicketDetail } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function SupportTicketPage() {
  return (
    <RequireAuth>
      <Ticket />
    </RequireAuth>
  );
}

function Ticket() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { me } = useAuth();
  const { id } = useParams<{ id: string }>();
  const ticket = useApi<SupportTicketDetail>(`/support/tickets/${id}`);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    // Ikki marta bosish: `busy` keyingi render'gacha yangilanmaydi — ref darhol to'sadi
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await session.post<SupportTicketDetail>(`/support/tickets/${id}/messages`, { body: body.trim() });
      ticket.setData(r.data);
      setBody("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }

  const tk = ticket.data;
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 py-8">
      <Link href="/support" className="text-sm text-muted hover:text-fg">
        ← {t("support.back")}
      </Link>
      {ticket.loading ? (
        <Spinner className="mx-auto my-12 h-6 w-6" />
      ) : ticket.error || !tk ? (
        <Alert>{ticket.error}</Alert>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">{t(`support.type.${tk.type}` as MessageKey)}</span>
              <TicketStatusBadge status={tk.status} />
              {tk.club_name && <span className="text-xs text-muted">· {tk.club_name}</span>}
            </div>
            <Heading className="break-words">{tk.subject}</Heading>
          </div>
          <MessageThread messages={tk.messages} mineId={me?.id ?? ""} />
          {tk.can_reply ? (
            <Card>
              <form onSubmit={send} className="space-y-3">
                <textarea className={textarea} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("support.replyPh")} maxLength={4000} required />
                {error && <Alert>{error}</Alert>}
                <Button type="submit" loading={busy} disabled={!body.trim()}>
                  {t("support.send")}
                </Button>
              </form>
            </Card>
          ) : (
            <Card className="text-center text-sm text-muted">{t("support.closedNote")}</Card>
          )}
        </>
      )}
    </main>
  );
}
