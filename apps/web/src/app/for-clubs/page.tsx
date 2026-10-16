"use client";

import { BarChart3, CalendarCheck, CheckCircle2, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { api } from "@/lib/api";
import { normalizePhone } from "@/lib/use-api";

// Allaqachon ulangan klub egalari uchun panel manzili (masalan https://club.<domen>). Sozlanmagan bo'lsa — havola yo'q.
const CLUB_PANEL_URL = process.env.NEXT_PUBLIC_CLUB_PANEL_URL || null;
const UZ_PHONE = /^\+998\d{9}$/;

type Form = { full_name: string; phone: string; club_name: string; city: string; address: string; devices_count: string; branches_count: string; telegram: string; comment: string };
const EMPTY: Form = { full_name: "", phone: "+998 ", club_name: "", city: "", address: "", devices_count: "", branches_count: "", telegram: "", comment: "" };

/** Klub egasi ulanish arizasi: akkauntsiz forma → super admin paneliga (`POST /club-applications`). */
export default function ForClubsPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const phone = normalizePhone(f.phone);
    if (!UZ_PHONE.test(phone)) return setError(t("apply.invalidPhone"));
    setBusy(true);
    setError(null);
    try {
      await api.post("/club-applications", {
        full_name: f.full_name.trim(),
        phone,
        club_name: f.club_name.trim(),
        city: f.city.trim(),
        address: f.address.trim() || undefined,
        devices_count: f.devices_count ? Number(f.devices_count) : undefined,
        branches_count: f.branches_count ? Number(f.branches_count) : undefined,
        telegram: f.telegram.trim() || undefined,
        comment: f.comment.trim() || undefined,
        language: locale,
      });
      setSentTo(phone);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const consent = t("apply.consent").split(/(\{partner\})/);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-8 sm:py-14">
      <div className="grid items-start gap-10 lg:grid-cols-[1fr_minmax(0,520px)]">
        <section className="space-y-6 lg:sticky lg:top-24">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-sm font-bold text-accent">
            <Sparkles className="h-4 w-4" />
            {t("apply.kicker")}
          </span>
          <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">{t("apply.title")}</h1>
          <p className="max-w-lg text-muted">{t("apply.subtitle")}</p>
          <ul className="space-y-3">
            {[
              { icon: Users, key: "apply.benefit.clients" },
              { icon: CalendarCheck, key: "apply.benefit.booking" },
              { icon: BarChart3, key: "apply.benefit.reports" },
            ].map((b) => (
              <li key={b.key} className="flex items-center gap-3 font-semibold">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface text-accent">
                  <b.icon className="h-5 w-5" />
                </span>
                {t(b.key as "apply.benefit.clients")}
              </li>
            ))}
          </ul>
          <div className="rounded-[20px] border border-line-soft p-5">
            <div className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">{t("apply.steps.title")}</div>
            <ol className="space-y-2.5 text-sm">
              {(["apply.step1", "apply.step2", "apply.step3"] as const).map((k, i) => (
                <li key={k} className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent font-bold text-on-accent">{i + 1}</span>
                  {t(k)}
                </li>
              ))}
            </ol>
          </div>
          {CLUB_PANEL_URL && (
            <p className="text-sm text-muted">
              {t("apply.haveAccount")}{" "}
              <a href={CLUB_PANEL_URL} className="font-semibold text-fg underline decoration-line underline-offset-2 hover:text-accent">
                {t("apply.login")}
              </a>
            </p>
          )}
        </section>

        <Card className="p-6 sm:p-8">
          {sentTo ? (
            <div className="flex flex-col items-center gap-4 py-10 text-center" role="status">
              <CheckCircle2 className="h-14 w-14 text-accent" />
              <h2 className="font-display text-2xl font-bold">{t("apply.success.title")}</h2>
              <p className="text-muted">{t("apply.success.text", { phone: sentTo })}</p>
              <Link href="/" className="mt-2 inline-flex h-11 items-center rounded-xl border border-line bg-surface px-5 text-sm font-semibold hover:border-muted/60">
                {t("apply.success.home")}
              </Link>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <h2 className="font-display text-xl font-bold">{t("apply.form.title")}</h2>
              <Field label={t("apply.fullName")}>
                <Input value={f.full_name} onChange={set("full_name")} autoComplete="name" minLength={2} maxLength={120} required />
              </Field>
              <Field label={t("apply.phone")} hint={t("apply.phoneHint")}>
                <Input type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("apply.clubName")}>
                  <Input value={f.club_name} onChange={set("club_name")} minLength={2} maxLength={120} required />
                </Field>
                <Field label={t("apply.city")}>
                  <Input value={f.city} onChange={set("city")} autoComplete="address-level2" minLength={2} maxLength={80} required />
                </Field>
              </div>
              <Field label={`${t("apply.address")} · ${t("apply.optional")}`}>
                <Input value={f.address} onChange={set("address")} autoComplete="street-address" maxLength={300} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label={`${t("apply.devices")} · ${t("apply.optional")}`}>
                  <Input type="number" inputMode="numeric" min={1} max={10000} value={f.devices_count} onChange={set("devices_count")} />
                </Field>
                <Field label={`${t("apply.branches")} · ${t("apply.optional")}`}>
                  <Input type="number" inputMode="numeric" min={1} max={1000} value={f.branches_count} onChange={set("branches_count")} />
                </Field>
              </div>
              <Field label={`${t("apply.telegram")} · ${t("apply.optional")}`}>
                <Input value={f.telegram} onChange={set("telegram")} placeholder="@username" maxLength={100} />
              </Field>
              <Field label={`${t("apply.comment")} · ${t("apply.optional")}`}>
                <textarea
                  value={f.comment}
                  onChange={set("comment")}
                  rows={3}
                  maxLength={2000}
                  placeholder={t("apply.commentPlaceholder")}
                  className="w-full rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px] text-fg outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </Field>
              {error && <Alert>{error}</Alert>}
              <Button type="submit" size="lg" loading={busy} className="w-full">
                {t("apply.submit")}
              </Button>
              <p className="text-center text-xs leading-5 text-muted">
                {consent.map((p, i) =>
                  p === "{partner}" ? (
                    <Link key={i} href="/legal/partner" target="_blank" className="font-semibold text-fg underline decoration-line underline-offset-2 hover:text-accent">
                      {t("legal.partner")}
                    </Link>
                  ) : (
                    <Fragment key={i}>{p}</Fragment>
                  ),
                )}
              </p>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
