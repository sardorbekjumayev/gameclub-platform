"use client";

import { formatDateTime } from "@gc/types";
import { ArrowLeft, Phone, Send } from "lucide-react";
import { useState } from "react";
import { Pager } from "@/components/analytics";
import { type ClubLead, type ClubLeadDetail, type LeadStatus, LeadStatusBadge } from "@/components/club-leads";
import { Empty, LoadState } from "@/components/status";
import { textarea } from "@/components/support";
import { Alert, Button, Card, Chip, Heading, Input, cx } from "@/components/ui";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import { useApi } from "@/lib/use-api";

const LIMIT = 20;
const FILTERS = ["NEW", "CONTACTED", "APPROVED", "REJECTED", ""] as const;

/** Super admin: zonup.uz dagi "Klub ochish" formasidan kelgan ulanish arizalari. */
export default function ClubLeadsPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("NEW");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
  if (filter) params.set("status", filter);
  if (q.trim()) params.set("q", q.trim());
  const list = useApi<ClubLead[]>(`/admin/club-applications?${params}`);

  return (
    <div className="space-y-5">
      <div>
        <Heading>{t("leads.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("leads.subtitle")}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <section className={cx("min-w-0 space-y-3", selected && "hidden lg:block")}>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Chip
                key={f}
                active={filter === f}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
              >
                {f ? t(`leads.status.${f}` as MessageKey) : t("leads.filter.all")}
              </Chip>
            ))}
          </div>
          <Input
            className="h-10 text-sm"
            placeholder={t("leads.searchPlaceholder")}
            value={q}
            maxLength={100}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
          {list.data?.length === 0 && <Empty>{t("leads.empty")}</Empty>}
          <ul className="space-y-2">
            {list.data?.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSelected(a.id)}
                  className={cx(
                    "block w-full rounded-2xl border p-3.5 text-left transition",
                    selected === a.id ? "border-accent bg-accent/5" : "border-line bg-surface hover:border-muted/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {a.status === "NEW" && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={t("leads.status.NEW")} />}
                    <span className="min-w-0 flex-1 truncate font-semibold">{a.club_name}</span>
                    <span className="shrink-0 text-xs text-muted">{formatDateTime(a.created_at)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <LeadStatusBadge status={a.status} />
                    <span className="text-muted">{a.city}</span>
                    {a.devices_count && <span className="text-muted">· {a.devices_count} PC</span>}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {a.full_name} · {a.phone}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <Pager page={page} total={list.meta?.total ?? 0} limit={LIMIT} onPage={setPage} />
        </section>

        <section className={cx("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <LeadPane key={selected} id={selected} onBack={() => setSelected(null)} onChanged={list.reload} />
          ) : (
            <Card className="py-16 text-center text-sm text-muted">{t("leads.selectHint")}</Card>
          )}
        </section>
      </div>
    </div>
  );
}

function LeadPane({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const lead = useApi<ClubLeadDetail>(`/admin/club-applications/${id}`);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = lead.data;

  async function update(key: string, body: { status?: LeadStatus; admin_note?: string }) {
    setBusy(key);
    setError(null);
    try {
      const r = await session.patch<ClubLeadDetail>(`/admin/club-applications/${id}`, body);
      lead.setData(r.data);
      if (body.admin_note !== undefined) setNote(null);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const handler = a?.handler ? [a.handler.first_name, a.handler.last_name].filter(Boolean).join(" ") || a.handler.email || "—" : null;
  const tg = a?.telegram?.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
  const rows: [MessageKey, React.ReactNode][] = a
    ? [
        ["leads.fullName", a.full_name],
        ["leads.city", a.city],
        ["leads.address", a.address],
        ["leads.devices", a.devices_count],
        ["leads.branches", a.branches_count],
        ["leads.language", a.language.toUpperCase()],
      ]
    : [];

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg lg:hidden">
        <ArrowLeft className="h-4 w-4" />
        {t("leads.back")}
      </button>
      <LoadState loading={lead.loading} error={lead.error} onRetry={lead.reload} />
      {a && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <LeadStatusBadge status={a.status} />
            {handler && a.handled_at && <span className="text-xs text-muted">{t("leads.handled", { name: handler, when: formatDateTime(a.handled_at) })}</span>}
            <span className="ml-auto text-xs text-muted">{formatDateTime(a.created_at)}</span>
          </div>
          <h2 className="break-words font-display text-2xl font-bold">{a.club_name}</h2>
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${a.phone}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-bold text-on-accent hover:bg-accent-hover">
              <Phone className="h-4 w-4" />
              {a.phone}
            </a>
            {tg && (
              <a
                href={`https://t.me/${encodeURIComponent(tg)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-muted/60"
              >
                <Send className="h-4 w-4" />
                {a.telegram}
              </a>
            )}
          </div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{t(k)}</dt>
                  <dd className="break-words font-semibold">{v}</dd>
                </div>
              ))}
          </dl>
          {a.comment && (
            <div>
              <div className="text-xs text-muted">{t("leads.comment")}</div>
              <p className="mt-1 whitespace-pre-wrap break-words rounded-xl bg-surface-2 p-3 text-sm">{a.comment}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
            {a.status !== "CONTACTED" && a.status !== "APPROVED" && a.status !== "REJECTED" && (
              <Button size="sm" loading={busy === "CONTACTED"} disabled={!!busy} onClick={() => update("CONTACTED", { status: "CONTACTED" })}>
                {t("leads.markContacted")}
              </Button>
            )}
            {a.status !== "APPROVED" && a.status !== "REJECTED" && (
              <Button size="sm" variant={a.status === "CONTACTED" ? "primary" : "secondary"} loading={busy === "APPROVED"} disabled={!!busy} onClick={() => update("APPROVED", { status: "APPROVED" })}>
                {t("leads.markApproved")}
              </Button>
            )}
            {a.status !== "APPROVED" && a.status !== "REJECTED" && (
              <Button size="sm" variant="danger" loading={busy === "REJECTED"} disabled={!!busy} onClick={() => update("REJECTED", { status: "REJECTED" })}>
                {t("leads.markRejected")}
              </Button>
            )}
            {(a.status === "APPROVED" || a.status === "REJECTED") && (
              <Button size="sm" variant="secondary" loading={busy === "reopen"} disabled={!!busy} onClick={() => update("reopen", { status: "CONTACTED" })}>
                {t("leads.reopen")}
              </Button>
            )}
          </div>
          <div className="space-y-2 border-t border-line-soft pt-4">
            <label htmlFor="lead-note" className="text-xs font-semibold text-muted">
              {t("leads.note")}
            </label>
            <textarea
              id="lead-note"
              className={textarea}
              rows={3}
              maxLength={2000}
              placeholder={t("leads.notePlaceholder")}
              value={note ?? a.admin_note ?? ""}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button size="sm" variant="secondary" loading={busy === "note"} disabled={!!busy || note === null || note === (a.admin_note ?? "")} onClick={() => update("note", { admin_note: note ?? "" })}>
              {t("leads.saveNote")}
            </Button>
          </div>
          {error && <Alert>{error}</Alert>}
        </Card>
      )}
    </div>
  );
}
