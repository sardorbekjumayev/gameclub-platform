"use client";

import type { LoginResult, SendOtpResult } from "@gc/types";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LegalConsent } from "@/components/legal-consent";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

const normalizePhone = (v: string) => {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  return `+${digits}`;
};

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { me, signIn } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+998 ");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState<SendOtpResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromBooking = useSearchParams().get("reason") === "book";

  useEffect(() => {
    // Kirgan foydalanuvchi — faqat ochilganda (verify'dan keyingi yo'naltirishni buzmaslik uchun)
    if (me && !busy) router.replace("/profile");
  }, [me, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await session.post<SendOtpResult>("/auth/send-otp", { phone: normalizePhone(phone), purpose: "LOGIN" });
      setSent(res.data);
      // Raqam botga hali bog'lanmagan — botni yangi oynada ochamiz (kontakt ulashilgach kod botga keladi)
      if (!res.data.delivered) window.open(res.data.bot_url, "_blank", "noopener");
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

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await session.post<LoginResult>("/auth/verify-otp", { phone: normalizePhone(phone), code: value, device: { platform: "web" } });
      signIn(res.data);
      // Faqat ichki yo'l (open redirect oldi)
      const next = new URLSearchParams(window.location.search).get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      // busy yoqiq qoladi — aks holda "kirgan foydalanuvchi → /profile" effekti `next` ni bosib ketadi
      router.replace(safeNext ?? (res.data.is_new ? "/profile?welcome=1" : "/"));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-5 font-display text-2xl font-bold">{t("auth.title")}</h1>
        {fromBooking && step === "phone" && (
          <div className="mb-4">
            <Alert tone="info">{t("auth.reasonBook")}</Alert>
          </div>
        )}
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
            <LegalConsent kind="login" />
          </form>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify(code);
            }}
          >
            {sent && !sent.delivered ? (
              <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
                <p>{t("auth.tgLinkHint")}</p>
                <a
                  href={sent.bot_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#229ED9] font-bold text-white transition hover:brightness-110"
                >
                  {t("auth.openBot")}
                </a>
                <ol className="list-decimal space-y-1 pl-5 text-muted">
                  <li>{t("auth.tgStep1")}</li>
                  <li>{t("auth.tgStep2")}</li>
                  <li>{t("auth.tgStep3")}</li>
                </ol>
              </div>
            ) : (
              <p className="text-sm text-muted">{sent?.channel === "DEV" ? t("auth.codeSentDev") : t("auth.codeSent", { phone: normalizePhone(phone) })}</p>
            )}
            <Field label={t("auth.code")} hint={sent?.channel === "DEV" ? t("auth.devHint") : undefined}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(next);
                  // 6 raqam to'lganda avtomatik tasdiqlash — qo'shimcha bosish shart emas
                  if (next.length === 6 && !busy) void verify(next);
                }}
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
