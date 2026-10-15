"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BranchForm } from "@/components/branch-form";
import { Alert, Button, Card, Field, Heading, Input, cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { isPlatformStaff } from "@/lib/panel";
import { session, useAuth } from "@/lib/session";
import type { Branch, Club } from "@/lib/types";
import { normalizePhone } from "@/lib/use-api";

const STEPS = ["onboarding.step.club", "onboarding.step.branch", "onboarding.step.submit"] as const;

/** Klub ochish wizard'i: profil → birinchi filial → moderatsiyaga yuborish (docs/01-API.md §6.1). */
export default function NewClubPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const { me, reload } = useAuth();
  const [step, setStep] = useState(0);
  const [club, setClub] = useState<Club | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState({ name: "", phone: me?.phone ?? "", description: "", telegram: "", instagram: "", owner_password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function createClub(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      phone: normalizePhone(form.phone),
      ...(form.description && { description: form.description }),
      ...(form.telegram && { telegram: form.telegram }),
      ...(form.instagram && { instagram: form.instagram }),
      ...(!club && !me?.has_password && { owner_password: form.owner_password }),
    };
    try {
      const res = club ? await session.patch<Club>(`/clubs/${club.id}`, body) : await session.post<Club>("/clubs", body);
      setClub(res.data);
      setStep(1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish(submit: boolean) {
    if (!club) return;
    setBusy(true);
    setError(null);
    try {
      if (submit) await session.post(`/clubs/${club.id}/submit`);
      // Yangi CLUB_OWNER roli /auth/me ga tushishi uchun
      await reload();
      router.replace(`/clubs/${club.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (isPlatformStaff(me)) return <Alert tone="info">{t("onboarding.platformStaff")}</Alert>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Heading>{t("onboarding.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("onboarding.subtitle")}</p>
      </div>
      <ol className="flex gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className={cx("flex-1 rounded-xl border px-3 py-2 text-xs font-bold", i === step ? "border-accent text-accent" : i < step ? "border-line text-fg" : "border-line-soft text-muted")}>
            {i + 1}. {t(s)}
          </li>
        ))}
      </ol>
      {error && <Alert>{error}</Alert>}

      {step === 0 && (
        <Card>
          <form onSubmit={createClub} className="space-y-4">
            <Field label={t("club.name")}>
              <Input value={form.name} onChange={set("name")} minLength={2} maxLength={120} required autoFocus />
            </Field>
            <Field label={t("club.phone")}>
              <Input type="tel" value={form.phone} onChange={set("phone")} placeholder="+998 90 123 45 67" required />
            </Field>
            <Field label={t("club.description")}>
              <textarea
                value={form.description}
                onChange={set("description")}
                maxLength={4000}
                rows={4}
                className="rounded-[14px] border border-line bg-surface px-4 py-3 text-[15px] text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Telegram">
                <Input value={form.telegram} onChange={set("telegram")} placeholder="@club" maxLength={100} />
              </Field>
              <Field label="Instagram">
                <Input value={form.instagram} onChange={set("instagram")} placeholder="club" maxLength={100} />
              </Field>
            </div>
            {!me?.has_password && (
              <Field label={t("onboarding.ownerPassword")} hint={t("onboarding.ownerPasswordHint")}>
                <Input type="password" value={form.owner_password} onChange={set("owner_password")} minLength={8} maxLength={128} autoComplete="new-password" required />
              </Field>
            )}
            <Button type="submit" loading={busy}>
              {t("common.continue")}
            </Button>
          </form>
        </Card>
      )}

      {step === 1 && club && (
        <Card className="space-y-4">
          {branches.length > 0 && (
            <ul className="space-y-2">
              {branches.map((b) => (
                <li key={b.id} className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
                  <div className="font-bold">{b.name}</div>
                  <div className="text-muted">{b.address}</div>
                </li>
              ))}
            </ul>
          )}
          <BranchForm key={branches.length} clubId={club.id} submitLabel={t("onboarding.addBranch")} onSaved={(b) => setBranches((l) => [...l, b])} />
          <div className="flex justify-between gap-2 border-t border-line-soft pt-4">
            <Button variant="ghost" onClick={() => setStep(0)}>
              {t("common.back")}
            </Button>
            <Button disabled={branches.length === 0} onClick={() => setStep(2)}>
              {t("common.continue")}
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && club && (
        <Card className="space-y-4">
          <div className="font-display text-lg font-bold">{club.name}</div>
          <div className="text-sm text-muted">{t("clubs.branchesCount", { count: branches.length })}</div>
          <Alert tone="info">{t("onboarding.submitInfo")}</Alert>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              {t("common.back")}
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" loading={busy} onClick={() => finish(false)}>
                {t("onboarding.saveDraft")}
              </Button>
              <Button loading={busy} onClick={() => finish(true)}>
                {t("onboarding.submit")}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted">
            {t("legal.consent.submit")}{" "}
            <Link href="/partner-terms" target="_blank" className="font-semibold text-fg underline underline-offset-2 hover:text-accent">
              {t("legal.partnerLink")}
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}
