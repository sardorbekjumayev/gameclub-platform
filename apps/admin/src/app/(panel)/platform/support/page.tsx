"use client";

import { formatDateTime } from "@gc/types";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Pager } from "@/components/analytics";
import { Empty, LoadState } from "@/components/status";
import {
  MessageThread,
  ReplyBox,
  type SupportTicket,
  type SupportTicketDetail,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  type TicketStatus,
  TicketStatusBadge,
  userName,
} from "@/components/support";
import { Alert, Badge, Button, Card, Chip, Heading, Input, Select, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const LIMIT = 20;
const FILTERS = ["AWAITING", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", ""] as const;

/** Super admin / support: barcha rollardan kelgan talab va takliflar inbox'i. */
export default function PlatformSupportPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("AWAITING");
  const [type, setType] = useState("");
  const [sender, setSender] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const params = new URLSearchParams({ all: "true", page: String(page), limit: String(LIMIT) });
  if (filter === "AWAITING") params.set("awaiting", "true");
  else if (filter) params.set("status", filter);
  if (type) params.set("type", type);
  if (sender) params.set("sender", sender);
  if (q.trim()) params.set("q", q.trim());
  const list = useApi<SupportTicket[]>(`/support/tickets?${params}`);

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div>
        <Heading>{t("support.inbox")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("support.inboxSubtitle")}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <section className={cx("min-w-0 space-y-3", selected && "hidden lg:block")}>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Chip key={f} active={filter === f} onClick={() => reset(setFilter)(f)}>
                {f === "AWAITING" ? t("support.filter.awaiting") : f ? t(`support.status.${f}` as MessageKey) : t("support.filter.all")}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select className="h-10 text-sm" value={type} onChange={(e) => reset(setType)(e.target.value)} aria-label={t("support.type")}>
              <option value="">{t("support.filter.allTypes")}</option>
              {TICKET_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`support.type.${k}` as MessageKey)}
                </option>
              ))}
            </Select>
            <Select className="h-10 text-sm" value={sender} onChange={(e) => reset(setSender)(e.target.value)} aria-label={t("support.from")}>
              <option value="">{t("support.filter.anySender")}</option>
              <option value="CUSTOMER">{t("support.sender.CUSTOMER")}</option>
              <option value="STAFF">{t("support.sender.STAFF")}</option>
            </Select>
          </div>
          <Input className="h-10 text-sm" placeholder={t("common.search")} value={q} maxLength={100} onChange={(e) => reset(setQ)(e.target.value)} />
          <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
          {list.data?.length === 0 && <Empty>{t("support.empty")}</Empty>}
          <ul className="space-y-2">
            {list.data?.map((tk) => (
              <li key={tk.id}>
                <button
                  type="button"
                  onClick={() => setSelected(tk.id)}
                  className={cx(
                    "block w-full rounded-2xl border p-3.5 text-left transition",
                    selected === tk.id ? "border-accent bg-accent/5" : "border-line bg-surface hover:border-muted/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {tk.awaiting_reply && (tk.status === "OPEN" || tk.status === "IN_PROGRESS") && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={t("support.filter.awaiting")} />}
                    <span className="min-w-0 flex-1 truncate font-semibold">{tk.subject}</span>
                    <span className="shrink-0 text-xs text-muted">{formatDateTime(tk.last_message_at)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge tone={tk.sender_role === "CUSTOMER" ? "neutral" : "violet"}>{t(`support.role.${tk.sender_role}` as MessageKey)}</Badge>
                    <span className="font-bold uppercase tracking-wide text-muted">{t(`support.type.${tk.type}` as MessageKey)}</span>
                    <TicketStatusBadge status={tk.status} />
                    {(tk.priority === "HIGH" || tk.priority === "URGENT") && <Badge tone="red">{t(`support.priority.${tk.priority}` as MessageKey)}</Badge>}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {userName(tk.user)}
                    {tk.club_name ? ` · ${tk.club_name}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <Pager page={page} total={list.meta?.total ?? 0} limit={LIMIT} onPage={setPage} />
        </section>

        <section className={cx("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <TicketPane key={selected} id={selected} onBack={() => setSelected(null)} onChanged={list.reload} />
          ) : (
            <Card className="py-16 text-center text-sm text-muted">{t("support.selectHint")}</Card>
          )}
        </section>
      </div>
    </div>
  );
}

function TicketPane({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const ticket = useApi<SupportTicketDetail>(`/support/tickets/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tk = ticket.data;

  async function update(key: string, body: { status?: TicketStatus; priority?: string }) {
    setBusy(key);
    setError(null);
    try {
      await session.patch(`/admin/support/tickets/${id}`, body);
      ticket.reload();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg lg:hidden">
        <ArrowLeft className="h-4 w-4" />
        {t("support.back")}
      </button>
      <LoadState loading={ticket.loading} error={ticket.error} onRetry={ticket.reload} />
      {tk && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">{t(`support.type.${tk.type}` as MessageKey)}</span>
              <TicketStatusBadge status={tk.status} />
              <span className="ml-auto text-xs text-muted">{formatDateTime(tk.created_at)}</span>
            </div>
            <h2 className="break-words font-display text-xl font-bold">{tk.subject}</h2>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">{t("support.from")}</dt>
                <dd className="font-semibold">
                  {userName(tk.user)} <span className="font-normal text-muted">· {t(`support.role.${tk.sender_role}` as MessageKey)}</span>
                </dd>
                <dd className="text-xs text-muted">{[tk.user?.phone, tk.user?.email].filter(Boolean).join(" · ")}</dd>
              </div>
              {tk.club_name && (
                <div>
                  <dt className="text-xs text-muted">{t("support.club")}</dt>
                  <dd className="font-semibold">{tk.club_name}</dd>
                </div>
              )}
            </dl>
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
              {tk.status !== "RESOLVED" && tk.status !== "CLOSED" && (
                <Button size="sm" loading={busy === "RESOLVED"} onClick={() => update("RESOLVED", { status: "RESOLVED" })}>
                  {t("support.markResolved")}
                </Button>
              )}
              {tk.status !== "CLOSED" ? (
                <Button size="sm" variant="secondary" loading={busy === "CLOSED"} onClick={() => update("CLOSED", { status: "CLOSED" })}>
                  {t("support.close")}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" loading={busy === "OPEN"} onClick={() => update("OPEN", { status: "OPEN" })}>
                  {t("support.reopen")}
                </Button>
              )}
              <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                {t("support.priority")}
                <Select className="h-9 w-auto text-sm" value={tk.priority} disabled={!!busy} onChange={(e) => update("priority", { priority: e.target.value })}>
                  {TICKET_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`support.priority.${p}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            {error && <Alert>{error}</Alert>}
          </Card>
          <MessageThread ticket={tk} viewer="platform" />
          <Card>
            {tk.can_reply ? (
              <ReplyBox
                ticketId={tk.id}
                onSent={(next) => {
                  ticket.setData(next);
                  onChanged();
                }}
              />
            ) : (
              <p className="text-center text-sm text-muted">{t("support.closedNote")}</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
