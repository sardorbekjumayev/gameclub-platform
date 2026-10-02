"use client";

import type { LoginResult } from "@gc/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Alert, Button, Card, Field, Input, Logo, Spinner } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

type Preview = { club_name: string; branch_name: string | null; role: string; phone: string; expires_at: string; has_account: boolean };

/** Xodim taklifini qabul qilish: /invite?token=... (docs/01-API.md §4.2). */
export default function InvitePage() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  );
}

function InviteForm() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const { signIn } = useAuth();
  // Token birinchi renderda olinadi; keyin manzil satridan olib tashlanadi
  const params = useSearchParams();
  const [token] = useState(() => params.get("token"));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const loadError = token ? fetchError : t("invite.invalid");
  const [form, setForm] = useState({ first_name: "", last_name: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, "", "/invite");
    if (!token) return;
    session.post<Preview>("/auth/invitations/preview", { token }).then(
      (r) => setPreview(r.data),
      (e) => setFetchError((e as { code?: string }).code === "NOT_FOUND" ? t("invite.invalid") : errorText(e)),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { token, password: form.password, ...(form.first_name && { first_name: form.first_name }), ...(form.last_name && { last_name: form.last_name }) };
      const res = await session.post<LoginResult>("/auth/invitations/accept", body);
      signIn(res.data);
      router.replace("/clubs");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-between">
          <Logo />
          <LocaleSwitcher />
        </div>
        <Card className="space-y-4 p-6">
          <h1 className="font-display text-2xl font-bold">{t("invite.title")}</h1>
          {loadError && <Alert>{loadError}</Alert>}
          {!loadError && !preview && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          {preview && (
            <form onSubmit={accept} className="space-y-4">
              <p className="text-sm text-muted">
                {t("invite.body", { club: preview.club_name, role: t(`role.${preview.role}` as never) })}
                {preview.branch_name && ` · ${preview.branch_name}`}
              </p>
              <div className="font-mono text-xs text-muted">{preview.phone}</div>
              {error && <Alert>{error}</Alert>}
              {!preview.has_account && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("profile.firstName")}>
                    <Input value={form.first_name} onChange={set("first_name")} maxLength={80} />
                  </Field>
                  <Field label={t("profile.lastName")}>
                    <Input value={form.last_name} onChange={set("last_name")} maxLength={80} />
                  </Field>
                </div>
              )}
              <Field label={preview.has_account ? t("invite.existingPassword") : t("invite.newPassword")} hint={preview.has_account ? t("invite.existingHint") : t("profile.passwordHint")}>
                <Input type="password" value={form.password} onChange={set("password")} minLength={8} maxLength={128} autoComplete={preview.has_account ? "current-password" : "new-password"} required />
              </Field>
              <Button type="submit" size="lg" loading={busy} className="w-full">
                {t("invite.accept")}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
