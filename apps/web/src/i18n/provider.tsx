"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import en from "./messages/en.json";
import ru from "./messages/ru.json";
import uz from "./messages/uz.json";

export const LOCALES = ["uz", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof uz;

const dictionaries: Record<Locale, Record<string, string>> = { uz, ru, en };
const STORAGE_KEY = "gc.locale";

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: (key: MessageKey, vars?: Record<string, string | number>) => string };
const I18nContext = createContext<Ctx | null>(null);

const listeners = new Set<() => void>();

function readLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    return saved && LOCALES.includes(saved) ? saved : "uz";
  } catch {
    return "uz";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => "uz" as Locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
    listeners.forEach((cb) => cb());
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      let s = dictionaries[locale][key] ?? uz[key] ?? key;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
    [locale],
  );

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** API xato kodini lokalizatsiya qilingan matnga aylantiradi (klient `error.code` bo'yicha ishlaydi). */
/** Barqaror (t o'zgarmaguncha bir xil) — effect bog'liqliklarida ishlatish xavfsiz. */
export function useErrorText() {
  const { t } = useI18n();
  return useCallback((e: unknown) => {
    const { code, details } = (e ?? {}) as { code?: string; details?: { reason?: unknown } };
    // Aniqroq matn: `errors.<CODE>.<details.reason>` (masalan TRANSFER_PENDING)
    const reasonKey = `errors.${code}.${details?.reason}` as MessageKey;
    if (code && typeof details?.reason === "string" && reasonKey in uz) return t(reasonKey);
    const key = `errors.${code}` as MessageKey;
    return code && key in uz ? t(key) : t("errors.UNKNOWN");
  }, [t]);
}
