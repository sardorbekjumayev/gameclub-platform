"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Alert, Button, Card, Field, Input, Logo } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

/**
 * Admin parolni tiklagan (`me.must_change_password`) — har uchala panelda boshqa sahifalardan oldin
 * yangi parol o'rnatish ekrani. Saqlangach `/auth/me` qayta yuklanadi va panel ochiladi.
 */
export function ForcePasswordChange() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { reload, signOut } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("forcePw.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await session.post("/auth/password", { password });
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-4 py-10">
      <div className="flex items-center justify-between">
        <Logo className="text-xl" />
        <LocaleSwitcher />
      </div>
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
            <KeyRound className="h-5 w-5" />
          </span>
          <h1 className="font-display text-xl font-bold">{t("forcePw.title")}</h1>
        </div>
        <p className="text-sm text-muted">{t("forcePw.body")}</p>
        {error && <Alert>{error}</Alert>}
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("forcePw.password")} hint={t("profile.passwordHint")}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required autoFocus />
          </Field>
          <Field label={t("forcePw.confirm")}>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            {t("forcePw.submit")}
          </Button>
        </form>
      </Card>
      <Button
        variant="ghost"
        onClick={async () => {
          await signOut();
          router.replace("/login");
        }}
      >
        {t("auth.logout")}
      </Button>
    </main>
  );
}
