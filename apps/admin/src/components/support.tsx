"use client";

import { formatDateTime } from "@gc/types";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Chip, Field, Input, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";

export const TICKET_TYPES = ["SUGGESTION", "REQUEST", "COMPLAINT", "QUESTION", "BUG", "PAYMENT", "OTHER"] as const;
export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type SupportMessage = { id: string; sender_id: string; sender_name: string | null; body: string; is_staff: boolean; created_at: string };
type UserBrief = { id: string; phone: string | null; email: string | null; first_name: string | null; last_name: string | null };
export type SupportTicket = {
  id: string;
  type: (typeof TICKET_TYPES)[number];
  subject: string;
  status: TicketStatus;
  priority: (typeof TICKET_PRIORITIES)[number];
  sender_role: string;
  awaiting_reply: boolean;
  last_message_at: string;
  created_at: string;
  club_name: string | null;
  user: UserBrief | null;
  _count?: { messages: number };
};
export type SupportTicketDetail = SupportTicket & { can_reply: boolean; messages: SupportMessage[] };

export const userName = (u: UserBrief | null) => (u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.phone || u.email || "—" : "—");

const TONE: Record<TicketStatus, "amber" | "violet" | "green" | "neutral"> = { OPEN: "amber", IN_PROGRESS: "violet", RESOLVED: "green", CLOSED: "neutral" };

export const textarea =
  "w-full rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px] text-fg outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useI18n();
  return <Badge tone={TONE[status]}>{t(`support.status.${status}` as MessageKey)}</Badge>;
}

/** Super admin menyusidagi "javob kutmoqda" soni; sahifa almashganda va har daqiqada yangilanadi. */
export function useSupportAwaiting(enabled: boolean, pathname: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      session.get<{ awaiting: number }>("/admin/support/stats").then(
        (r) => alive && setN(r.data.awaiting),
        () => undefined,
      );
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, pathname]);
  return enabled ? n : 0;
}

/** Klub/operator paneli: murojaat xodim nomidan (`as: STAFF`) — API rol va klubni o'zi aniqlaydi. */
export function NewTicketForm({ clubId, onCreated }: { clubId?: string | null; onCreated: (t: SupportTicketDetail) => void }) {
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
      const r = await session.post<SupportTicketDetail>("/support/tickets", {
        type,
        subject: subject.trim(),
        body: body.trim(),
        as: "STAFF",
        ...(clubId ? { club_id: clubId } : {}),
      });
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
          {TICKET_TYPES.filter((k) => k !== "PAYMENT").map((k) => (
            <Chip key={k} type="button" active={type === k} onClick={() => setType(k)}>
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

/**
 * Yozishmalar. `authorId` — murojaat egasi: uning xabarlari bir tomonda, platforma javoblari ikkinchi tomonda.
 * `viewer` platforma bo'lsa javob bergan xodim ismi ko'rinadi.
 */
export function MessageThread({ ticket, viewer }: { ticket: SupportTicketDetail; viewer: "author" | "platform" }) {
  const { t } = useI18n();
  return (
    <ul className="space-y-3">
      {ticket.messages.map((m) => {
        const right = viewer === "author" ? !m.is_staff : m.is_staff;
        const who = m.is_staff ? (viewer === "platform" ? m.sender_name ?? t("support.team") : t("support.team")) : viewer === "author" ? t("support.you") : userName(ticket.user);
        return (
          <li key={m.id} className={cx("flex", right ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[85%] rounded-2xl px-4 py-3", right ? "rounded-br-md bg-accent/15" : "rounded-bl-md border border-line bg-surface")}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-bold text-muted">
                <span className={cx(m.is_staff && "text-accent")}>{who}</span>
                <span className="font-normal">{formatDateTime(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-line break-words text-[15px]">{m.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ReplyBox({ ticketId, onSent }: { ticketId: string; onSent: (t: SupportTicketDetail) => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await session.post<SupportTicketDetail>(`/support/tickets/${ticketId}/messages`, { body: body.trim() });
      setBody("");
      onSent(r.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-3">
      <textarea className={textarea} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("support.replyPh")} maxLength={4000} required />
      {error && <Alert>{error}</Alert>}
      <Button type="submit" loading={busy} disabled={!body.trim()}>
        {t("support.send")}
      </Button>
    </form>
  );
}
