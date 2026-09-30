"use client";

import type { LoginResult } from "@gc/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Alert, Button, Card, Field, Input, Logo } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

export default function LoginPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { me, signIn } = useAuth();
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace("/");
  }, [me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await session.post<LoginResult>("/auth/login", { login, password, device: { platform: "web-admin" } });
      signIn(res.data);
      router.replace("/");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-between">
          <Logo />
          <LocaleSwitcher />
        </div>
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="font-display text-2xl font-bold">{t("auth.login.title")}</h1>
              <p className="mt-1 text-sm text-muted">{t("auth.login.subtitle")}</p>
            </div>
            {error && <Alert>{error}</Alert>}
            <Field label={t("auth.login.login")}>
              <Input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required autoFocus />
            </Field>
            <Field label={t("auth.login.password")}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </Field>
            <Button type="submit" loading={busy} size="lg" className="w-full">
              {t("auth.login.submit")}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
