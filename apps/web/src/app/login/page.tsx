"use client";

import type { LoginResult } from "@gc/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

const normalizePhone = (v: string) => {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  return `+${digits}`;
};

export default function LoginPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { me, signIn } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+998 ");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace("/profile");
  }, [me, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await session.post<{ resend_in: number }>("/auth/send-otp", { phone: normalizePhone(phone), purpose: "LOGIN" });
      setStep("code");
      setCode("");
      setCooldown(res.data.resend_in);
    } catch (err) {
      setError(errorText(err));
      const retry = (err as { details?: { retry_after?: number } }).details?.retry_after;
      if (retry) {
        setStep("code");
        setCooldown(retry);
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await session.post<LoginResult>("/auth/verify-otp", { phone: normalizePhone(phone), code, device: { platform: "web" } });
      signIn(res.data);
      router.replace(res.data.is_new ? "/profile?welcome=1" : "/");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-5 font-display text-2xl font-bold">{t("auth.title")}</h1>
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        {step === "phone" ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
          >
            <Field label={t("auth.phone")}>
              <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" autoFocus required />
            </Field>
            <Button type="submit" loading={busy} size="lg" className="w-full">
              {t("auth.sendCode")}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={verify}>
            <p className="text-sm text-muted">{t("auth.codeSent", { phone: normalizePhone(phone) })}</p>
            <Field label={t("auth.code")} hint={process.env.NODE_ENV !== "production" ? t("auth.devHint") : undefined}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center font-mono text-lg tracking-[0.5em]"
                autoFocus
                required
              />
            </Field>
            <Button type="submit" loading={busy} disabled={code.length !== 6} size="lg" className="w-full">
              {t("auth.verify")}
            </Button>
            <div className="flex justify-between text-sm">
              <button type="button" className="font-semibold text-muted hover:text-fg" onClick={() => setStep("phone")}>
                {t("auth.changePhone")}
              </button>
              {cooldown > 0 ? (
                <span className="text-muted">{t("auth.resendIn", { s: cooldown })}</span>
              ) : (
                <button type="button" className="font-bold text-accent hover:underline" onClick={sendCode}>
                  {t("auth.resend")}
                </button>
              )}
            </div>
          </form>
        )}
      </Card>
    </main>
  );
}
