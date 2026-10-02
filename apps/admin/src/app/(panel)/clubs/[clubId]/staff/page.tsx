"use client";

import { formatDateTime } from "@gc/types";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ClubHeader } from "@/components/club-tabs";
import { Empty, LoadState, StatusBadge } from "@/components/status";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import { type Branch, type Invitation, type StaffRow, STAFF_ROLES, needsBranch } from "@/lib/types";
import { idemKey, normalizePhone, useApi } from "@/lib/use-api";

export default function StaffPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const { can, me } = useAuth();
  const staff = useApi<StaffRow[]>(`/clubs/${clubId}/staff`);
  const invitations = useApi<Invitation[]>(`/clubs/${clubId}/staff/invitations`);
  const branches = useApi<Branch[]>(`/clubs/${clubId}/branches`);

  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<string>("OPERATOR");
  const [branchId, setBranchId] = useState("");
  const [created, setCreated] = useState<Invitation | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const branchName = (id: string | null) => (id ? branches.data?.find((b) => b.id === id)?.name ?? "—" : t("staff.allBranches"));

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(null);
    }
  }

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    run("invite", async () => {
      const body = { phone: normalizePhone(phone), role, ...(needsBranch(role) && { branch_id: branchId }) };
      const res = await session.post<Invitation>(`/clubs/${clubId}/staff/invitations`, body, { "Idempotency-Key": idemKey() });
      setCreated(res.data);
      setPhone("");
      setMsg({ tone: "success", text: t("staff.invited") });
      invitations.reload();
    });
  };

  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {can("staff.create") && (
        <Card className="space-y-4">
          <div className="font-display text-lg font-bold">{t("staff.invite")}</div>
          <form onSubmit={invite} className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
            <Field label={t("staff.phone")}>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" required />
            </Field>
            <Field label={t("staff.role")}>
              <Select value={role} onChange={(e) => setRole(e.target.value)}>
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}` as never)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("staff.branch")}>
              <Select value={needsBranch(role) ? branchId : ""} onChange={(e) => setBranchId(e.target.value)} disabled={!needsBranch(role)} required={needsBranch(role)}>
                <option value="">{needsBranch(role) ? t("staff.pickBranch") : t("staff.allBranches")}</option>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={busy === "invite"}>
              {t("staff.sendInvite")}
            </Button>
          </form>
          {created?.invite_url && (
            <Alert tone="info">
              {t("staff.devLink")}{" "}
              <a className="break-all font-mono text-xs underline" href={created.invite_url} target="_blank" rel="noreferrer">
                {created.invite_url}
              </a>
            </Alert>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="px-5 pt-5 font-display text-lg font-bold">{t("staff.title")}</div>
        <LoadState loading={staff.loading} error={staff.error} onRetry={staff.reload} />
        {staff.data && (
          <table className="mt-3 w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line-soft text-xs font-bold uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3">{t("users.col.name")}</th>
                <th className="px-5 py-3">{t("users.col.contact")}</th>
                <th className="px-5 py-3">{t("staff.role")}</th>
                <th className="px-5 py-3">{t("staff.branch")}</th>
                <th className="px-5 py-3">{t("users.col.lastLogin")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {staff.data.map((s) => (
                <tr key={s.id} className="border-b border-line-soft last:border-0">
                  <td className="px-5 py-3">{[s.user.first_name, s.user.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs">{s.user.phone ?? s.user.email}</td>
                  <td className="px-5 py-3">
                    <Badge tone={s.role === "CLUB_OWNER" ? "amber" : "violet"}>{t(`role.${s.role}` as never)}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted">{s.branch_name ?? t("staff.allBranches")}</td>
                  <td className="px-5 py-3 text-muted">{s.user.last_login_at ? formatDateTime(s.user.last_login_at, undefined, locale) : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    {can("staff.delete") && s.role !== "CLUB_OWNER" && s.user.id !== me?.id && (
                      <Button
                        size="sm"
                        variant="danger"
                        loading={busy === s.id}
                        onClick={() =>
                          confirm(t("staff.confirmRemove")) &&
                          run(s.id, async () => {
                            await session.delete(`/clubs/${clubId}/staff/${s.id}`);
                            staff.reload();
                          })
                        }
                      >
                        {t("staff.remove")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="space-y-3">
        <div className="font-display text-lg font-bold">{t("staff.invitations")}</div>
        <LoadState loading={invitations.loading} error={invitations.error} onRetry={invitations.reload} />
        {invitations.data?.length === 0 && <Empty>{t("staff.invitationsEmpty")}</Empty>}
        <ul className="space-y-2">
          {invitations.data?.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
              <div>
                <div className="font-mono text-xs">{i.phone_or_email}</div>
                <div className="text-xs text-muted">
                  {t(`role.${i.role}` as never)} · {branchName(i.branch_id)} · {t("staff.expires", { date: formatDateTime(i.expires_at, undefined, locale) })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={i.status} />
                {i.status === "PENDING" && can("staff.create") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === i.id}
                    onClick={() =>
                      run(i.id, async () => {
                        await session.delete(`/clubs/${clubId}/staff/invitations/${i.id}`);
                        invitations.reload();
                      })
                    }
                  >
                    {t("staff.revoke")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
