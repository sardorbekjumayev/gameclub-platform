"use client";

import { LOCALES, useI18n } from "@/i18n/provider";

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="flex rounded-xl border border-line bg-surface p-0.5 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`rounded-[10px] px-2.5 py-1.5 font-bold uppercase transition ${l === locale ? "bg-accent text-on-accent" : "text-muted hover:text-fg"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
