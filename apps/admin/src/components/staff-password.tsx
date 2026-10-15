"use client";

import type { Me } from "@gc/types";
import { Check, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Badge, Button, Card, Field, Input, Modal, cx } from "@/components/ui";
import { LoadState } from "@/components/status";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { StaffRow } from "@/lib/types";
import { idemKey, useApi } from "@/lib/use-api";

/**
 * Xodim parolini ierarxiya bo'yicha tiklash (docs/01-API.md §4.2). Darajalar API (`StaffService`) bilan mos —
 * bu yerda faqat tugmani ko'rsatish uchun; yakuniy tekshiruv serverda.
 */
const RANK: Record<string, number> = { SUPER_ADMIN: 100, CLUB_OWNER: 50, CLUB_ADMIN: 40, BRANCH_ADMIN: 30, OPERATOR: 20 };

const myRank = (me: Me, clubId: string) =>
  Math.max(0, ...me.roles.filter((r) => r.scope_type === "PLATFORM" || r.club_id === clubId).map((r) => RANK[r.role] ?? 0));

/** Shu klub xodimlari ro'yxatidan foydalanuvchining eng yuqori roli darajasi. */
const userRank = (rows: StaffRow[], userId: string) => Math.max(0, ...rows.filter((r) => r.user.id === userId).map((r) => RANK[r.role] ?? RANK.CLUB_ADMIN));

export function canResetPassword(me: Me | null, can: (p: string) => boolean, clubId: string, rows: StaffRow[], userId: string) {
  return !!me && can("staff.reset_password") && userId !== me.id && userRank(rows, userId) < myRank(me, clubId);
}

type ResetResult = { user_id: string; temporary_password: string | null; generated: boolean; sessions_revoked: number };

/** "Parolni tiklash" tugmasi + tasdiqlash oynasi + vaqtinchalik parolni bir marta ko'rsatish. */
export function ResetPasswordButton({ clubId, user, onDone }: { clubId: string; user: StaffRow["user"]; onDone?: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"generate" | "custom">("generate");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [copied, setCopied] = useState(false);
  // Bitta oyna — bitta kalit: ikki marta bosish yoki tarmoq qayta urinishi parolni ikki marta tiklamaydi
  const key = useRef(idemKey());
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.phone || user.email || "—";

  const close = () => {
    setOpen(false);
    setResult(null);
    setPassword("");
    setMode("generate");
    setError(null);
    setCopied(false);
    key.current = idemKey();
    if (result) onDone?.();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === "custom" ? { password } : {};
      const res = await session.post<ResetResult>(`/clubs/${clubId}/staff/users/${user.id}/reset-password`, body, { "Idempotency-Key": key.current });
      setResult(res.data);
    } catch (err) {
      setError(errorText(err));
      key.current = idemKey();
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!result?.temporary_password) return;
    try {
      await navigator.clipboard.writeText(result.temporary_password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4" />
        {t("pwreset.action")}
      </Button>
      {open && (
        <Modal title={result ? t("pwreset.doneTitle") : t("pwreset.title", { name })} onClose={close}>
          {result ? (
            <div className="space-y-4">
              {result.temporary_password ? (
                <>
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-3">
                    <code className="min-w-0 flex-1 select-all break-all font-mono text-lg font-bold tracking-wide">{result.temporary_password}</code>
                    <Button size="sm" variant="secondary" onClick={copy}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? t("pwreset.copied") : t("pwreset.copy")}
                    </Button>
                  </div>
                  <div className="flex gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{t("pwreset.warning")}</span>
                  </div>
                </>
              ) : (
                <Alert tone="info">{t("pwreset.replayed")}</Alert>
              )}
              <div className="text-xs text-muted">{t("pwreset.sessions", { n: result.sessions_revoked })}</div>
              <Button className="w-full" onClick={close}>
                {t("pwreset.close")}
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-sm text-muted">{t("pwreset.intro")}</p>
              {error && <Alert>{error}</Alert>}
              <div className="space-y-2 text-sm">
                {(["generate", "custom"] as const).map((m) => (
                  <label key={m} className={cx("flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5", mode === m ? "border-accent" : "border-line")}>
                    <input type="radio" name="pwmode" checked={mode === m} onChange={() => setMode(m)} />
                    {t(m === "generate" ? "pwreset.generate" : "pwreset.custom")}
                  </label>
                ))}
              </div>
              {mode === "custom" && (
                <Field label={t("pwreset.customLabel")} hint={t("profile.passwordHint")}>
                  <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} autoComplete="off" required />
                </Field>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={close}>
                  {t("pwreset.cancel")}
                </Button>
                <Button type="submit" variant="danger" loading={busy}>
                  {t("pwreset.submit")}
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

/** "Yangi parol kutilmoqda" belgisi (tiklangan, hali almashtirilmagan). */
export function PendingPasswordBadge({ user }: { user: StaffRow["user"] }) {
  const { t } = useI18n();
  return user.must_change_password ? <Badge tone="amber">{t("pwreset.pending")}</Badge> : null;
}

/** Platforma paneli, klub sahifasi: egasi va adminlari — parolni tiklash. */
export function ClubManagersCard({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const { me, can } = useAuth();
  const staff = useApi<StaffRow[]>(can("staff.view") ? `/clubs/${clubId}/staff` : null);
  if (!can("staff.reset_password")) return null;
  // Bir foydalanuvchi bir nechta rolda bo'lishi mumkin — bitta qator
  const managers = [...new Map((staff.data ?? []).filter((r) => r.role === "CLUB_OWNER" || r.role === "CLUB_ADMIN").map((r) => [r.user.id, r])).values()];
  return (
    <Card className="space-y-3">
      <div>
        <div className="font-display text-lg font-bold">{t("pwreset.managers")}</div>
        <div className="text-sm text-muted">{t("pwreset.managersHint")}</div>
      </div>
      <LoadState loading={staff.loading} error={staff.error} onRetry={staff.reload} />
      <ul className="space-y-2 text-sm">
        {managers.map((r) => (
          <li key={r.user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-bold">
                {[r.user.first_name, r.user.last_name].filter(Boolean).join(" ") || "—"}
                <Badge tone={r.role === "CLUB_OWNER" ? "amber" : "violet"}>{t(`role.${r.role}` as never)}</Badge>
                <PendingPasswordBadge user={r.user} />
              </div>
              <div className="font-mono text-xs text-muted">{r.user.phone ?? r.user.email}</div>
            </div>
            {canResetPassword(me, can, clubId, staff.data ?? [], r.user.id) && <ResetPasswordButton clubId={clubId} user={r.user} onDone={staff.reload} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}
