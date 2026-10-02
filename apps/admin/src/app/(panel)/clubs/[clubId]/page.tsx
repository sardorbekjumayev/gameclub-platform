"use client";

import { formatDateTime } from "@gc/types";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ClubHeader } from "@/components/club-tabs";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import { SubscriptionCard } from "@/components/subscription-card";
import type { Club, ClubDocument, ClubSubscription } from "@/lib/types";
import { normalizePhone, useApi } from "@/lib/use-api";

const DOC_TYPES = ["LICENSE", "TAX_ID", "PASSPORT", "OTHER"] as const;
const textarea =
  "rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60";

export default function ClubProfilePage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const club = useApi<Club>(`/clubs/${clubId}`);
  const sub = useApi<ClubSubscription>(can("clubs.view") ? `/clubs/${clubId}/subscription` : null);
  const canEdit = can("clubs.update");
  const canDocs = can("clubs.documents.manage");
  const docs = useApi<ClubDocument[]>(canDocs ? `/clubs/${clubId}/documents` : null);

  const [form, setForm] = useState({ name: "", phone: "", description: "", telegram: "", instagram: "", website: "", rules: "" });
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [doc, setDoc] = useState({ type: "LICENSE", file_url: "" });

  // Server javobi o'zgarganda formani qayta to'ldirish (render paytida, effect'siz)
  const [synced, setSynced] = useState<Club | null>(null);
  if (club.data && club.data !== synced) {
    const c = club.data;
    setSynced(c);
    setForm({ name: c.name, phone: c.phone ?? "", description: c.description ?? "", telegram: c.telegram ?? "", instagram: c.instagram ?? "", website: c.website ?? "", rules: c.rules ?? "" });
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function act(name: string, fn: () => Promise<void>, success: string) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: success });
    } catch (err) {
      const details = (err as { details?: { missing?: string[] } }).details;
      const missing = details?.missing?.map((m) => t(`club.missing.${m}` as never)).join(", ");
      setMsg({ tone: "error", text: missing ? `${t("club.incomplete")}: ${missing}` : errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries({ ...form, phone: form.phone ? normalizePhone(form.phone) : "" }).filter(([, v]) => v !== ""));
    act("save", async () => club.setData((await session.patch<Club>(`/clubs/${clubId}`, body)).data), t("common.saved"));
  };

  const c = club.data;
  const editable = canEdit && c && c.status !== "CLOSED";

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      <LoadState loading={club.loading} error={club.error} onRetry={club.reload} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {c && (
        <>
          {c.status === "REJECTED" && c.rejection_reason && <Alert>{t("club.rejectedReason", { reason: c.rejection_reason })}</Alert>}
          {c.status === "SUSPENDED" && <Alert>{t("club.suspendedReason", { reason: c.suspended_reason ?? "—" })}</Alert>}
          {c.status === "PENDING_APPROVAL" && <Alert tone="info">{t("club.pendingInfo")}</Alert>}
          {(c.status === "DRAFT" || c.status === "REJECTED") && canEdit && (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted">{t("club.submitHint")}</div>
              <Button
                loading={busy === "submit"}
                onClick={() => act("submit", async () => club.setData((await session.post<Club>(`/clubs/${clubId}/submit`)).data), t("club.submitted"))}
              >
                {t("onboarding.submit")}
              </Button>
            </Card>
          )}

          {sub.data && <SubscriptionCard data={sub.data} />}

          <Card>
            <form onSubmit={save} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t("club.name")}>
                  <Input value={form.name} onChange={set("name")} disabled={!editable} minLength={2} maxLength={120} required />
                </Field>
                <Field label={t("club.phone")}>
                  <Input type="tel" value={form.phone} onChange={set("phone")} disabled={!editable} />
                </Field>
                <Field label="Telegram">
                  <Input value={form.telegram} onChange={set("telegram")} disabled={!editable} maxLength={100} />
                </Field>
                <Field label="Instagram">
                  <Input value={form.instagram} onChange={set("instagram")} disabled={!editable} maxLength={100} />
                </Field>
                <Field label={t("club.website")}>
                  <Input type="url" value={form.website} onChange={set("website")} disabled={!editable} placeholder="https://" />
                </Field>
              </div>
              <Field label={t("club.description")}>
                <textarea className={textarea} rows={4} value={form.description} onChange={set("description")} disabled={!editable} maxLength={4000} />
              </Field>
              <Field label={t("club.rules")}>
                <textarea className={textarea} rows={3} value={form.rules} onChange={set("rules")} disabled={!editable} maxLength={4000} />
              </Field>
              {editable && (
                <Button type="submit" loading={busy === "save"}>
                  {t("common.save")}
                </Button>
              )}
            </form>
          </Card>

          {canDocs && (
            <Card className="space-y-4">
              <div className="font-display text-lg font-bold">{t("club.documents")}</div>
              <LoadState loading={docs.loading} error={docs.error} onRetry={docs.reload} />
              {docs.data?.length === 0 && <Empty>{t("club.documentsEmpty")}</Empty>}
              <ul className="space-y-2">
                {docs.data?.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
                    <div>
                      <div className="font-bold">{t(`doc.${d.type}` as never)}</div>
                      <a href={d.file_url} target="_blank" rel="noreferrer" className="break-all text-xs text-accent underline">
                        {d.file_url}
                      </a>
                      {d.note && <div className="text-xs text-muted">{d.note}</div>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      {formatDateTime(d.created_at, undefined, locale)}
                      <StatusBadge status={d.status} />
                    </div>
                  </li>
                ))}
              </ul>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    "doc",
                    async () => {
                      await session.post(`/clubs/${clubId}/documents`, doc);
                      setDoc((d) => ({ ...d, file_url: "" }));
                      docs.reload();
                    },
                    t("common.saved"),
                  );
                }}
              >
                <Select value={doc.type} onChange={(e) => setDoc((d) => ({ ...d, type: e.target.value }))}>
                  {DOC_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t(`doc.${d}` as never)}
                    </option>
                  ))}
                </Select>
                <Input className="min-w-60 flex-1" type="url" placeholder={t("club.documentUrl")} value={doc.file_url} onChange={(e) => setDoc((d) => ({ ...d, file_url: e.target.value }))} required />
                <Button type="submit" variant="secondary" loading={busy === "doc"}>
                  {t("common.add")}
                </Button>
              </form>
              <p className="text-xs text-muted">{t("club.documentUrlHint")}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
