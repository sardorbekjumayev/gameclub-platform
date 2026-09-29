"use client";

import { LOCALES, useI18n } from "@/i18n/provider";

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-zinc-800">
      {LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`rounded-md px-2 py-1 uppercase ${l === locale ? "bg-violet-600 text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
