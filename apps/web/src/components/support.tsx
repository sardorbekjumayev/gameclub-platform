"use client";

import { useState } from "react";
import { Alert, Badge, Button, Chip, Field, Input, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { fmtDate, fmtTime } from "@/lib/format";
import { session } from "@/lib/session";
import { TICKET_TYPES, type SupportMessage, type SupportTicket, type SupportTicketDetail, type TicketStatus } from "@/lib/types";

const TONE: Record<TicketStatus, "amber" | "violet" | "green" | "neutral"> = { OPEN: "amber", IN_PROGRESS: "violet", RESOLVED: "green", CLOSED: "neutral" };

export const textarea =
  "w-full rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px] text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useI18n();
  return <Badge tone={TONE[status]}>{t(`support.status.${status}` as MessageKey)}</Badge>;
}

/** Murojaat egasi uchun: platforma javob berganmi yoki hali kutilyaptimi. */
export function ReplyBadge({ ticket }: { ticket: SupportTicket }) {
  const { t } = useI18n();
  if (ticket.status === "CLOSED" || ticket.status === "RESOLVED") return null;
  return ticket.awaiting_reply ? <Badge>{t("support.waiting")}</Badge> : <Badge tone="green">{t("support.replied")}</Badge>;
}

export function NewTicketForm({ onCreated }: { onCreated: (t: SupportTicketDetail) => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [type, setType] = useState<(typeof TICKET_TYPES)[number]>("SUGGESTION");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await session.post<SupportTicketDetail>("/support/tickets", { type, subject: subject.trim(), body: body.trim() });
      setSubject("");
      setBody("");
      onCreated(r.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <span className="text-[13px] font-semibold text-muted">{t("support.type")}</span>
        <div className="flex flex-wrap gap-2">
          {TICKET_TYPES.map((k) => (
            <Chip key={k} active={type === k} onClick={() => setType(k)}>
              {t(`support.type.${k}` as MessageKey)}
            </Chip>
          ))}
        </div>
      </div>
      <Field label={t("support.subject")}>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("support.subjectPh")} minLength={3} maxLength={200} required />
      </Field>
      <Field label={t("support.body")}>
        <textarea className={textarea} rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("support.bodyPh")} maxLength={4000} required />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Button type="submit" loading={busy} disabled={subject.trim().length < 3 || !body.trim()}>
        {t("support.send")}
      </Button>
    </form>
  );
}

export function MessageThread({ messages, mineId }: { messages: SupportMessage[]; mineId: string }) {
  const { t } = useI18n();
  return (
    <ul className="space-y-3">
      {messages.map((m) => {
        const mine = m.sender_id === mineId && !m.is_staff;
        return (
          <li key={m.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[85%] rounded-2xl px-4 py-3", mine ? "rounded-br-md bg-accent/15" : "rounded-bl-md border border-line bg-surface")}>
              <div className="mb-1 flex items-center gap-2 text-xs font-bold text-muted">
                <span className={cx(!mine && "text-accent")}>{mine ? t("support.you") : t("support.team")}</span>
                <span className="font-normal">
                  {fmtDate(m.created_at, t as never)} · {fmtTime(m.created_at)}
                </span>
              </div>
              <p className="whitespace-pre-line break-words text-[15px]">{m.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
