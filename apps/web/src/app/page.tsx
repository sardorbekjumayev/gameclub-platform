"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

export default function Home() {
  const { t } = useI18n();
  const { me } = useAuth();
  const steps = [t("home.step1"), t("home.step2"), t("home.step3")];
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16 sm:px-8">
      <section className="relative overflow-hidden rounded-3xl bg-surface p-8 sm:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(#1e212b_1px,transparent_1px),linear-gradient(90deg,#1e212b_1px,transparent_1px)] [background-size:48px_48px]"
        />
        <div className="relative max-w-2xl space-y-5">
          <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">{t("home.title")}</h1>
          <p className="text-lg text-muted">{t("home.subtitle")}</p>
          <Link
            href={me ? "/profile" : "/login"}
            className="inline-flex h-[54px] items-center rounded-[14px] bg-accent px-7 text-base font-bold text-on-accent transition hover:bg-accent-hover"
          >
            {me ? t("home.ctaProfile") : t("home.cta")}
          </Link>
          <Link
            href="/map"
            className="ml-3 inline-flex h-[54px] items-center rounded-[14px] border border-line bg-surface px-7 text-base font-semibold transition hover:border-muted/60"
          >
            {t("nav.map")}
          </Link>
        </div>
      </section>
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s} className="rounded-[18px] border border-line bg-surface p-5">
            <div className="mb-3 font-display text-3xl font-bold text-accent">0{i + 1}</div>
            <div className="font-bold">{s}</div>
          </li>
        ))}
      </ol>
          </main>
  );
}
