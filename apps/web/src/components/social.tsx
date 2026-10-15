"use client";

import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";

export const SOCIAL_KINDS = ["instagram", "telegram", "tiktok", "youtube", "facebook"] as const;
export type SocialKind = (typeof SOCIAL_KINDS)[number];
export type Social = { links: Partial<Record<SocialKind, string>>; promo_enabled: boolean };

/** Brend nomlari — tarjima qilinmaydi. */
export const SOCIAL_NAMES: Record<SocialKind, string> = { instagram: "Instagram", telegram: "Telegram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook" };

// Sahifalar orasida bitta so'rov: sozlama kamdan-kam o'zgaradi
let cache: Promise<Social | null> | null = null;
const loadSocial = () =>
  (cache ??= session.get<Social>("/social").then(
    (r) => r.data,
    () => {
      cache = null;
      return null;
    },
  ));

export function useSocial() {
  const [social, setSocial] = useState<Social | null>(null);
  useEffect(() => {
    let alive = true;
    loadSocial().then((s) => alive && setSocial(s));
    return () => {
      alive = false;
    };
  }, []);
  return social;
}

const entries = (s: Social | null) => SOCIAL_KINDS.flatMap((k) => (s?.links[k] ? [[k, s.links[k]!] as const] : []));

export function SocialIcon({ kind, className }: { kind: SocialKind; className?: string }) {
  const p = { className: cx("h-5 w-5", className), viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (kind) {
    case "instagram":
      return (
        <svg {...p} fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "telegram":
      return (
        <svg {...p} fill="currentColor">
          <path d="M21.4 3.6 2.9 10.8c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.4l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.4-1.5ZM9.2 14l8.6-5.4c.4-.3.8-.1.5.2l-7.2 6.6-.3 3-1.6-4.4Z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...p} fill="currentColor">
          <path d="M16.6 3c.4 2.2 1.8 3.7 4 3.9v3.2c-1.5 0-2.8-.4-4-1.2v6.3c0 3.5-2.6 5.8-5.7 5.8A5.6 5.6 0 0 1 5.3 15.4c0-3.4 3-6 6.5-5.5v3.3c-1.6-.4-3.2.7-3.2 2.3 0 1.3 1 2.3 2.3 2.3 1.4 0 2.4-1 2.4-2.6V3h3.3Z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...p} fill="currentColor">
          <path d="M22 8.2c-.2-1.6-1-2.7-2.6-2.9C16.9 5 12 5 12 5s-4.9 0-7.4.3C3 5.5 2.2 6.6 2 8.2 1.8 9.5 1.8 12 1.8 12s0 2.5.2 3.8c.2 1.6 1 2.7 2.6 2.9 2.5.3 7.4.3 7.4.3s4.9 0 7.4-.3c1.6-.2 2.4-1.3 2.6-2.9.2-1.3.2-3.8.2-3.8s0-2.5-.2-3.8ZM10 15.2V8.8l5.3 3.2-5.3 3.2Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...p} fill="currentColor">
          <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1Z" />
        </svg>
      );
  }
}

/** Ikonka tugmalari qatori (footer va kartalar uchun). */
export function SocialLinks({ social, className, size = "md" }: { social: Social | null; className?: string; size?: "sm" | "md" }) {
  const list = entries(social);
  if (!list.length) return null;
  return (
    <div className={cx("flex flex-wrap gap-2", className)}>
      {list.map(([kind, url]) => (
        <a
          key={kind}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={SOCIAL_NAMES[kind]}
          title={SOCIAL_NAMES[kind]}
          className={cx(
            "grid place-items-center rounded-xl border border-line bg-surface text-muted transition hover:border-accent/50 hover:text-accent",
            size === "sm" ? "h-9 w-9" : "h-11 w-11",
          )}
        >
          <SocialIcon kind={kind} />
        </a>
      ))}
    </div>
  );
}

const DISMISS_KEY = "gc.social.dismissed";
const DISMISS_DAYS = 7;
const noop = () => () => {};
function readDismissed() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_DAYS * 86_400_000;
  } catch {
    return false; // storage yopiq — banner ko'rinaveradi
  }
}

/** Bosh sahifadagi yumshoq taklif: majburiy emas, yopilsa 7 kun ko'rinmaydi. */
export function SocialPromoBanner() {
  const { t } = useI18n();
  const social = useSocial();
  const recentlyDismissed = useSyncExternalStore(noop, readDismissed, () => true);
  const [closed, setClosed] = useState(false);
  const hidden = closed || recentlyDismissed;

  if (hidden || !social?.promo_enabled || !entries(social).length) return null;

  function dismiss() {
    setClosed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* e'tiborsiz */
    }
  }

  return (
    <section className="relative mt-6 flex flex-col gap-4 rounded-[22px] border border-accent/30 bg-accent/5 p-5 pr-12 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-display text-lg font-bold">{t("social.follow.title")}</h2>
        <p className="mt-1 text-sm text-muted">{t("social.follow.text")}</p>
      </div>
      <SocialLinks social={social} />
      <button type="button" onClick={dismiss} aria-label={t("social.dismiss")} title={t("social.dismiss")} className="absolute top-3 right-3 rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
        <X className="h-4 w-4" />
      </button>
    </section>
  );
}

/** Bron yoki arenda tasdiqlangandan keyin — eng qulay payt. */
export function SocialFollowCard() {
  const { t } = useI18n();
  const social = useSocial();
  if (!social?.promo_enabled || !entries(social).length) return null;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">{t("social.follow.after")}</p>
      <SocialLinks social={social} size="sm" className="shrink-0" />
    </div>
  );
}
