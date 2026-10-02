"use client";

import { formatDateTime } from "@gc/types";
import { Check, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Button, Card, Chip, Field, Heading, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { Club } from "@/lib/types";
import { normalizePhone, useApi } from "@/lib/use-api";

const FILTERS = ["PENDING_APPROVAL", "ACTIVE", "DRAFT", "REJECTED", "SUSPENDED", ""] as const;
const LIMIT = 20;

/** Super admin: klub arizalari navbati (docs/01-API.md §6.1 approval). */
export default function ClubApprovalsPage() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<string>("PENDING_APPROVAL");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), ...(status && { status }) });
  const { data, meta, loading, error, reload } = useApi<Club[]>(`/admin/clubs?${params}`);
  const pages = Math.max(1, Math.ceil((meta?.total ?? 0) / LIMIT));
  const errorText = useErrorText();
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null);

  async function approve(id: string) {
    setApproving(id);
    setError2(null);
    try {
      await session.post(`/admin/clubs/${id}/approve`, {});
      reload();
    } catch (e) {
      setError2(errorText(e));
    } finally {
      setApproving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading>{t("approvals.title")}</Heading>
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("clubCreate.button")}
          </Button>
        )}
      </div>
      {creating && <CreateClubForm onCancel={() => setCreating(false)} />}
      {error2 && <Alert>{error2}</Alert>}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip
            key={f || "all"}
            active={status === f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
          >
            {f ? t(`status.${f}` as never) : t("approvals.all")}
          </Chip>
        ))}
      </div>
      <LoadState loading={loading} error={error} onRetry={reload} />
      {!loading && data?.length === 0 && <Empty>{t("approvals.empty")}</Empty>}
      {!loading && !!data?.length && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line-soft text-xs font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">{t("club.name")}</th>
                <th className="px-4 py-3">{t("approvals.owner")}</th>
                <th className="px-4 py-3">{t("club.tab.branches")}</th>
                <th className="px-4 py-3">{t("club.documents")}</th>
                <th className="px-4 py-3">{t("users.col.status")}</th>
                <th className="px-4 py-3">{t("users.col.created")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-line-soft transition last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3 font-bold">
                    <Link href={`/platform/clubs/${c.id}`} className="hover:text-accent">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.owner?.phone ?? c.owner?.email ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{c._count?.branches ?? 0}</td>
                  <td className="px-4 py-3 tabular-nums">{c._count?.documents ?? 0}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDateTime(c.created_at, undefined, locale)}</td>
                  <td className="px-4 py-3 text-right">
                    {c.status === "PENDING_APPROVAL" && (
                      <Button size="sm" loading={approving === c.id} disabled={!!approving} onClick={() => approve(c.id)}>
                        <Check className="h-4 w-4" /> {t("approvals.action.approve")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{t("common.page", { page, pages })}</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("common.prev")}
          </Button>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Super admin klubni egasi nomidan qo'shadi — klub darhol ACTIVE (moderatsiyasiz), sinov muddati avtomatik boshlanadi. */
function CreateClubForm({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const [f, setF] = useState({ name: "", phone: "", owner_phone: "", owner_first_name: "", owner_last_name: "", owner_password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await session.post<{ id: string }>("/admin/clubs", {
        name: f.name.trim(),
        owner_phone: normalizePhone(f.owner_phone),
        activate: true,
        ...(f.phone.trim() && { phone: normalizePhone(f.phone) }),
        ...(f.owner_first_name.trim() && { owner_first_name: f.owner_first_name.trim() }),
        ...(f.owner_last_name.trim() && { owner_last_name: f.owner_last_name.trim() }),
        ...(f.owner_password && { owner_password: f.owner_password }),
      });
      router.push(`/platform/clubs/${res.data.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <div className="font-display text-lg font-bold">{t("clubCreate.title")}</div>
          <p className="text-sm text-muted">{t("clubCreate.hint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("club.name")}>
            <Input required minLength={2} maxLength={120} value={f.name} onChange={set("name")} />
          </Field>
          <Field label={t("clubCreate.clubPhone")}>
            <Input type="tel" placeholder="+998 90 123 45 67" value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label={t("clubCreate.ownerPhone")}>
            <Input required type="tel" placeholder="+998 90 123 45 67" value={f.owner_phone} onChange={set("owner_phone")} />
          </Field>
          <Field label={t("clubCreate.ownerPassword")} hint={t("clubCreate.ownerPasswordHint")}>
            <Input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={f.owner_password} onChange={set("owner_password")} />
          </Field>
          <Field label={t("clubCreate.ownerFirstName")}>
            <Input maxLength={80} value={f.owner_first_name} onChange={set("owner_first_name")} />
          </Field>
          <Field label={t("clubCreate.ownerLastName")}>
            <Input maxLength={80} value={f.owner_last_name} onChange={set("owner_last_name")} />
          </Field>
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" loading={busy}>
            {t("clubCreate.submit")}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
