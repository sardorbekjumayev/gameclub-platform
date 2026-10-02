"use client";

import type { LoginResult, SendOtpResult } from "@gc/types";
import { CheckCircle2, KeyRound, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Alert, Button, Card, Chip, Field, Input, Logo } from "@/components/ui";
import { PANEL_ICON } from "@/components/wrong-panel";
import { type MessageKey, useErrorText, useI18n } from "@/i18n/provider";
import { PANEL, panelUrl } from "@/lib/panel";
import { session, useAuth } from "@/lib/session";
import { normalizePhone } from "@/lib/use-api";

const PanelIcon = PANEL_ICON[PANEL];

export default function LoginPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { me, signIn } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sent, setSent] = useState<SendOtpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace("/");
  }, [me, router]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const finish = (r: LoginResult) => {
    signIn(r);
    router.replace("/");
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => finish((await session.post<LoginResult>("/auth/login", { login, password, device: { platform: "web-admin" } })).data));
  };

  const submitOtp = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (!codeSent) {
        const res = await session.post<SendOtpResult>("/auth/send-otp", { phone: normalizePhone(phone), purpose: "LOGIN" });
        setSent(res.data);
        if (!res.data.delivered) window.open(res.data.bot_url, "_blank", "noopener");
        setCodeSent(true);
        return;
      }
      finish((await session.post<LoginResult>("/auth/verify-otp", { phone: normalizePhone(phone), code, device: { platform: "web-admin" } })).data);
    });
  };

  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <section className="relative hidden overflow-hidden border-r border-line-soft bg-surface p-12 lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-accent/10 blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(#1e212b_1px,transparent_1px),linear-gradient(90deg,#1e212b_1px,transparent_1px)] [background-size:48px_48px]"
        />
        <Logo className="relative" />
        <div className="relative space-y-6">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent text-on-accent">
            <PanelIcon className="h-8 w-8" />
          </span>
          <h2 className="font-display text-4xl font-bold leading-tight">{t(`panel.${PANEL}` as MessageKey)}</h2>
          <p className="max-w-md text-lg text-muted">{t(`panel.${PANEL}.desc` as MessageKey)}</p>
          <ul className="space-y-3">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="flex items-center gap-3 text-[15px]">
                <CheckCircle2 className="h-5 w-5 text-accent" />
                {t(`panel.${PANEL}.f${n}` as MessageKey)}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex flex-wrap gap-2 text-sm">
          {(["platform", "club", "desk"] as const)
            .filter((k) => k !== PANEL)
            .map((k) => {
              const Icon = PANEL_ICON[k];
              return (
                <a key={k} href={panelUrl(k)} className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 font-semibold text-muted transition hover:border-accent/50 hover:text-fg">
                  <Icon className="h-4 w-4" />
                  {t(`panel.${k}` as MessageKey)}
                </a>
              );
            })}
        </div>
      </section>
      <div className="flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-between">
          <span className="lg:invisible">
            <Logo />
          </span>
          <LocaleSwitcher />
        </div>
        <Card className="space-y-4 border border-line-soft p-6">
          <div>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-accent lg:hidden">
              <PanelIcon className="h-3.5 w-3.5" />
              {t(`panel.${PANEL}` as MessageKey)}
            </div>
            <h1 className="font-display text-2xl font-bold">{t("auth.login.title")}</h1>
            <p className="mt-1 text-sm text-muted">{t("auth.login.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <Chip active={mode === "password"} onClick={() => setMode("password")}>
              <KeyRound className="mr-1.5 inline h-3.5 w-3.5" />
              {t("auth.login.byPassword")}
            </Chip>
            <Chip active={mode === "otp"} onClick={() => setMode("otp")}>
              <Smartphone className="mr-1.5 inline h-3.5 w-3.5" />
              {t("auth.login.byOtp")}
            </Chip>
          </div>
          {error && <Alert>{error}</Alert>}
          {mode === "password" ? (
            <form onSubmit={submitPassword} className="space-y-4">
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
          ) : (
            <form onSubmit={submitOtp} className="space-y-4">
              <Field label={t("auth.login.phone")}>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 90 123 45 67" disabled={codeSent} required autoFocus />
              </Field>
              {codeSent && sent && !sent.delivered && (
                <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
                  <p className="text-muted">{t("auth.login.tgLinkHint")}</p>
                  <a href={sent.bot_url} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center justify-center rounded-xl bg-[#229ED9] font-bold text-white hover:brightness-110">
                    {t("auth.login.openBot")}
                  </a>
                </div>
              )}
              {codeSent && sent?.delivered && <p className="text-sm text-muted">{sent.channel === "DEV" ? t("auth.login.devHint") : t("auth.login.codeSentTg")}</p>}
              {codeSent && (
                <Field label={t("auth.login.code")}>
                  <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" required autoFocus />
                </Field>
              )}
              <Button type="submit" loading={busy} size="lg" className="w-full">
                {codeSent ? t("auth.login.submit") : t("auth.login.sendCode")}
              </Button>
              <p className="text-xs text-muted">{t("auth.login.otpHint")}</p>
            </form>
          )}
        </Card>
      </div>
      </div>
    </main>
  );
}
