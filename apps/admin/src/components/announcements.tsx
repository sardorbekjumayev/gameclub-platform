"use client";

import { useState } from "react";
import { Empty, LoadState } from "@/components/status";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { useErrorText, useI18n, type MessageKey } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Announcement = { id: string; title: string; body: string; audience: string; starts_at: string | null; ends_at: string | null; created_at: string };

/**
 * E'lon / broadcast boshqaruvi. Klub (`announcements.manage`) va platforma
 * (`platform.announcements.manage`) panellari uchun umumiy — yo'llar prop orqali.
 */
export function AnnouncementsManager({
  listPath,
  basePath,
  permission,
  audiences,
}: {
  listPath: string;
  basePath: string;
  permission: string;
  audiences: readonly string[];
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { can } = useAuth();
  const editable = can(permission);
  const list = useApi<Announcement[]>(listPath);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState(audiences[0]);
  const [notify, setNotify] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.post(basePath, {
        title,
        body,
        audience,
        notify,
        ...(endsAt ? { ends_at: new Date(endsAt).toISOString() } : {}),
      });
      setTitle("");
      setBody("");
      setNotify(false);
      setEndsAt("");
      list.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("ann.confirmDelete"))) return;
    try {
      await session.delete(`${basePath}/${id}`);
      list.reload();
    } catch (err) {
      alert(errorText(err));
    }
  }

  return (
    <div className="space-y-5">
      {editable && (
        <Card>
          <form onSubmit={create} className="space-y-4">
            {error && <Alert>{error}</Alert>}
            <Field label={t("ann.title")}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} minLength={2} maxLength={150} required />
            </Field>
            <Field label={t("ann.body")}>
              <textarea
                className="min-h-24 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                minLength={2}
                maxLength={4000}
                required
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("ann.audience")}>
                <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
                  {audiences.map((a) => (
                    <option key={a} value={a}>
                      {t(`ann.audience.${a}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("ann.endsAt")} hint={t("ann.endsAtHint")}>
                <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              {t("ann.notify")}
            </label>
            <Button type="submit" loading={busy}>
              {t("ann.publish")}
            </Button>
          </form>
        </Card>
      )}

      <LoadState loading={list.loading} error={list.error} onRetry={list.reload} />
      {list.data?.length === 0 && <Empty>{t("ann.empty")}</Empty>}
      <div className="space-y-3">
        {list.data?.map((a) => (
          <Card key={a.id} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-lg font-bold">{a.title}</div>
                <div className="text-xs text-muted">
                  {t(`ann.audience.${a.audience}` as MessageKey)}
                  {a.ends_at ? ` · ${t("ann.until")} ${new Date(a.ends_at).toLocaleString()}` : ""}
                </div>
              </div>
              {editable && (
                <button className="shrink-0 text-xs text-danger-soft hover:underline" onClick={() => remove(a.id)}>
                  {t("common.delete")}
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap text-sm text-muted">{a.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
