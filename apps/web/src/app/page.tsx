"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

export default function Home() {
  const { t } = useI18n();
  const { me } = useAuth();
  const steps = [t("home.step1"), t("home.step2"), t("home.step3")];
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <section className="max-w-2xl space-y-5">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("home.title")}</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">{t("home.subtitle")}</p>
        <Link
          href={me ? "/profile" : "/login"}
          className="inline-flex h-11 items-center rounded-lg bg-violet-600 px-5 font-medium text-white hover:bg-violet-500"
        >
          {me ? t("home.ctaProfile") : t("home.cta")}
        </Link>
      </section>
      <ol className="mt-14 grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              {i + 1}
            </div>
            <div className="font-medium">{s}</div>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-sm text-zinc-500">{t("home.soon")}</p>
    </main>
  );
}
