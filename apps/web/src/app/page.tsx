"use client";

import { formatMoney } from "@gc/types";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarCheck,
  Car,
  CreditCard,
  Gamepad,
  Gamepad2,
  MapPin,
  Monitor,
  QrCode,
  Radar,
  Search,
  Sparkles,
  Star,
  TrendingUp,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActiveSessions } from "@/components/active-sessions";
import { SocialPromoBanner } from "@/components/social";
import { type MessageKey, useI18n } from "@/i18n/provider";
import type { BranchCard } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const CATEGORIES = [
  { type: "PC", icon: Monitor },
  { type: "PS5", icon: Gamepad2 },
  { type: "XBOX", icon: Gamepad },
  { type: "RACING_SIMULATOR", icon: Car },
] as const;

export default function Home() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const top = useApi<BranchCard[]>("/discovery/search?limit=6&sort=rating");
  const clubs = top.data ?? [];
  const free = clubs.reduce((n, b) => n + b.free_devices, 0);
  const openNow = clubs.filter((b) => b.is_open_now).length;

  return (
    <main className="flex-1">
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-accent/15 blur-[120px]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(#1e212b_1px,transparent_1px),linear-gradient(90deg,#1e212b_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-14 pb-16 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:pt-20 lg:pb-24">
          <div className="space-y-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3.5 py-1.5 text-[13px] font-bold text-accent">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              {t("home.badge")}
            </span>
            <h1 className="font-display text-[40px] font-bold leading-[1.05] tracking-tight sm:text-6xl">
              {t("home.title")} <span className="bg-gradient-to-r from-accent to-[#7dffb3] bg-clip-text text-transparent">{t("home.titleAccent")}</span>
            </h1>
            <p className="max-w-xl text-lg text-muted">{t("home.subtitle")}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                router.push(q.trim() ? `/clubs?q=${encodeURIComponent(q.trim())}` : "/clubs");
              }}
              className="flex max-w-xl items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-[0_20px_60px_-20px_rgba(198,255,61,0.25)] focus-within:border-accent"
            >
              <Search className="ml-2 h-5 w-5 shrink-0 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("home.searchPlaceholder")}
                className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
              />
              <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent transition hover:bg-accent-hover">
                <span className="hidden sm:inline">{t("home.cta")}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Link
                  key={c.type}
                  href={`/clubs?device=${c.type}`}
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-2 text-sm font-semibold transition hover:border-accent/60 hover:text-accent"
                >
                  <c.icon className="h-4 w-4" />
                  {t(`deviceType.${c.type}` as MessageKey)}
                </Link>
              ))}
              <Link href="/map" className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-2 text-sm font-semibold transition hover:border-accent/60 hover:text-accent">
                <MapPin className="h-4 w-4" />
                {t("nav.map")}
              </Link>
            </div>
          </div>

          {/* "Jonli" karta — haqiqiy klub ma'lumotlari */}
          <div className="relative hidden lg:block">
            <div aria-hidden className="absolute -inset-6 rounded-[32px] bg-gradient-to-br from-accent/20 to-transparent blur-2xl" />
            <div className="relative space-y-3 rounded-[28px] border border-line bg-surface/90 p-5 backdrop-blur">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold">
                  <Radar className="h-5 w-5 text-accent" />
                  {t("home.liveNow")}
                </div>
                <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">LIVE</span>
              </div>
              {(clubs.length ? clubs.slice(0, 3) : [null, null, null]).map((b, i) =>
                b ? (
                  <Link key={b.id} href={`/clubs/${b.id}`} className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 transition hover:bg-surface-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-3 text-accent">
                      <Gamepad2 className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{b.club_name}</div>
                      <div className="truncate text-xs text-muted">{b.address}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-lg font-bold text-accent">{b.free_devices}</div>
                      <div className="text-[11px] text-muted">{t("home.freeShort")}</div>
                    </div>
                  </Link>
                ) : (
                  <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-surface-2" />
                ),
              )}
              <div className="grid grid-cols-8 gap-1.5 pt-2" aria-hidden>
                {Array.from({ length: 24 }, (_, i) => (
                  <div key={i} className={`h-6 rounded-md ${[2, 5, 6, 11, 14, 17, 20, 21].includes(i) ? "bg-surface-3" : i % 7 === 0 ? "bg-warn/40" : "bg-accent/70"}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <ActiveSessions />
        <SocialPromoBanner />

        {/* STATISTIKA */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: Building2, value: clubs.length ? `${clubs.length}+` : "—", label: t("home.stat.clubs") },
            { icon: Zap, value: openNow || "—", label: t("home.stat.open") },
            { icon: Monitor, value: free || "—", label: t("home.stat.free") },
            { icon: QrCode, value: "24/7", label: t("home.stat.booking") },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-line-soft bg-surface p-5">
              <s.icon className="h-5 w-5 text-accent" />
              <div className="mt-3 font-display text-3xl font-bold tabular-nums">{s.value}</div>
              <div className="text-sm text-muted">{s.label}</div>
            </div>
          ))}
        </section>

        {/* KONSOL ARENDASI */}
        <Link
          href="/rentals"
          className="group mt-6 flex flex-wrap items-center gap-5 rounded-[24px] border border-line-soft bg-surface p-6 transition hover:border-accent/50 sm:p-7"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent">
            <Gamepad2 className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl font-bold sm:text-2xl">{t("home.rent.title")}</div>
            <div className="text-sm text-muted">{t("home.rent.text")}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-accent group-hover:underline">
            {t("home.rent.cta")}
            <ArrowRight className="h-4 w-4" />
          </span>
        </Link>

        {/* TOP KLUBLAR */}
        <section className="mt-20 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-accent">
                <TrendingUp className="h-4 w-4" />
                {t("home.top.kicker")}
              </div>
              <h2 className="font-display text-3xl font-bold sm:text-4xl">{t("home.top.title")}</h2>
            </div>
            <Link href="/clubs" className="inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:underline">
              {t("home.top.all")} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {top.loading && Array.from({ length: 3 }, (_, i) => <div key={i} className="h-64 animate-pulse rounded-[20px] bg-surface" />)}
            {!top.loading && clubs.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-line py-12 text-center text-muted">{top.error ?? t("clubs.empty")}</div>
            )}
            {clubs.map((b) => (
              <Link key={b.id} href={`/clubs/${b.id}`} className="group overflow-hidden rounded-[20px] border border-line-soft bg-surface transition hover:-translate-y-1 hover:border-accent/40">
                <div className="relative h-40 overflow-hidden bg-surface-3">
                  {b.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.cover_url} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-3 via-surface-2 to-accent/25">
                      <Gamepad2 className="h-14 w-14 text-accent/60 transition duration-500 group-hover:scale-110" />
                    </div>
                  )}
                  <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur ${b.is_open_now ? "bg-accent/90 text-on-accent" : "bg-black/60 text-muted"}`}>
                    {b.is_open_now ? t("clubs.open") : t("clubs.closed")}
                  </span>
                  {b.rating_count > 0 && (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold backdrop-blur">
                      <Star className="h-3.5 w-3.5 fill-warn text-warn" />
                      {b.rating_avg.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <div className="font-display text-lg font-bold">{b.club_name}</div>
                  <div className="flex items-center gap-1.5 text-sm text-muted">
                    <MapPin className="h-4 w-4 shrink-0" />
                    <span className="truncate">{b.address}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-line-soft pt-3 text-sm">
                    <span className="inline-flex items-center gap-1.5 font-bold text-accent">
                      <Monitor className="h-4 w-4" />
                      {t("map.free", { n: b.free_devices })}
                    </span>
                    {b.price_from != null && <span className="font-semibold">{t("map.priceFrom", { price: formatMoney(b.price_from, locale) })}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* QANDAY ISHLAYDI */}
        <section className="mt-24 space-y-8">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{t("home.how.title")}</h2>
            <p className="mx-auto mt-2 max-w-lg text-muted">{t("home.how.subtitle")}</p>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {[
              { icon: Search, title: t("home.step1"), text: t("home.step1.text") },
              { icon: CalendarCheck, title: t("home.step2"), text: t("home.step2.text") },
              { icon: QrCode, title: t("home.step3"), text: t("home.step3.text") },
            ].map((s, i) => (
              <li key={s.title} className="relative overflow-hidden rounded-[20px] border border-line-soft bg-surface p-6">
                <span className="absolute right-4 top-2 font-display text-7xl font-bold text-surface-3">{i + 1}</span>
                <span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-accent text-on-accent">
                  <s.icon className="h-6 w-6" />
                </span>
                <div className="relative mt-5 text-lg font-bold">{s.title}</div>
                <p className="relative mt-1.5 text-sm text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* AFZALLIKLAR */}
        <section className="mt-24 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Radar, key: "realtime" },
            { icon: CreditCard, key: "pay" },
            { icon: QrCode, key: "qr" },
            { icon: BadgeCheck, key: "verified" },
          ].map((f) => (
            <div key={f.key} className="rounded-[20px] border border-line-soft bg-gradient-to-b from-surface to-bg p-6">
              <f.icon className="h-7 w-7 text-accent" />
              <div className="mt-4 font-bold">{t(`home.feature.${f.key}` as MessageKey)}</div>
              <p className="mt-1.5 text-sm text-muted">{t(`home.feature.${f.key}.text` as MessageKey)}</p>
            </div>
          ))}
        </section>

        {/* KLUB EGALARI UCHUN */}
        <section className="relative mt-24 mb-20 overflow-hidden rounded-[28px] bg-accent p-8 text-on-accent sm:p-12">
          <div aria-hidden className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/25 blur-3xl" />
          <div className="relative grid items-center gap-8 md:grid-cols-[1.5fr_1fr]">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-2 rounded-full bg-on-accent/10 px-3 py-1 text-sm font-bold">
                <Sparkles className="h-4 w-4" />
                {t("home.owner.kicker")}
              </span>
              <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{t("home.owner.title")}</h2>
              <p className="max-w-lg font-semibold opacity-75">{t("home.owner.text")}</p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              {/* Klub egasi avval ariza qoldiradi — super admin bog'lanib, klubni ulaydi */}
              <Link href="/for-clubs" className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-on-accent px-7 font-bold text-accent transition hover:scale-[1.02]">
                <Building2 className="h-5 w-5" />
                {t("home.owner.cta")}
              </Link>
              <span className="text-sm font-semibold opacity-70">{t("home.owner.note")}</span>
            </div>
          </div>
        </section>
      </div>
      {/* Footer — barcha sahifalarda (layout → SiteFooter) */}
    </main>
  );
}
