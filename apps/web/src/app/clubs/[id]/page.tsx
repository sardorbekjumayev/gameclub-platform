"use client";

import { formatMoney } from "@gc/types";
import {
  Armchair,
  Car,
  Clock,
  Coffee,
  CreditCard,
  CupSoda,
  DoorOpen,
  Gamepad2,
  Globe,
  type LucideIcon,
  MapPin,
  Monitor,
  Navigation,
  Phone,
  Send,
  Snowflake,
  Sparkles,
  Star,
  Store,
  Trophy,
  Tv,
  UtensilsCrossed,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookingWidget } from "@/components/booking-widget";
import { BranchReviews } from "@/components/branch-reviews";
import { FavoriteButton, useFavorites } from "@/components/favorite-button";
import { RentalCard } from "@/components/rental-card";
import { Alert, Badge, Card, Spinner, cx } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { fmtTime } from "@/lib/format";
import type { BranchCard, BranchDetail, RentalItem, Tariff, WorkingHours } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];

const AMENITY_ICON: Record<string, LucideIcon> = {
  wifi: Wifi,
  parking: Car,
  snacks: Coffee,
  drinks: CupSoda,
  food: UtensilsCrossed,
  ac: Snowflake,
  lounge: Armchair,
  tournaments: Trophy,
  tv: Tv,
};
const AMENITIES = new Set(Object.keys(AMENITY_ICON));

const DEVICE_ICON: Record<string, LucideIcon> = { PC: Monitor };

/** Filial vaqt zonasidagi bugungi hafta kuni (mon..sun). */
function todayIn(tz: string): Day {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date()).toLowerCase().slice(0, 3) as Day;
}

const hoursKey = (h: WorkingHours, d: Day) => (h[d] ?? []).map((w) => `${w.open}-${w.close}`).join(",");

/** Filial sahifasi (docs/01-API.md §6.7): asosiy ma'lumotlar, jihozlar, qulayliklar, ish vaqti, tariflar, sharhlar + bron vidjeti. */
export default function BranchPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const branch = useApi<BranchDetail>(`/branches/${id}`);
  const summary = useApi<BranchCard>(`/branches/${id}/summary`);
  const tariffs = useApi<Tariff[]>(`/branches/${id}/tariffs`);
  const rentals = useApi<RentalItem[]>(`/rental-items?branch_id=${id}`);
  const fav = useFavorites();

  if (branch.loading) return <Spinner className="mx-auto my-24 h-6 w-6" />;
  if (branch.error || !branch.data)
    return (
      <main className="mx-auto max-w-xl flex-1 px-4 py-16">
        <Alert>{branch.error ?? t("clubs.notFound")}</Alert>
      </main>
    );

  const b = branch.data;
  const s = summary.data;
  const tz = b.timezone;
  const today = todayIn(tz);
  const isOpen = s?.is_open_now ?? b.is_open ?? false;
  const openUntil = s?.open_until ?? b.open_until ?? null;
  const priceFrom = s?.price_from ?? b.min_price_per_hour ?? null;
  const phone = b.phone ?? b.club.phone;
  const cover = b.cover_url ?? b.images?.[0] ?? null;
  const about = [...new Set([b.club.description, b.description].filter((x): x is string => !!x?.trim()))];
  const amenities = [...new Set([...(b.amenities ?? []), ...(b.club.amenities ?? [])])];
  const deviceTypes = b.device_types ?? [];
  const totalDevices = s?.total_devices ?? deviceTypes.reduce((n, d) => n + d.count, 0);
  const todayHours = b.working_hours[today] ?? [];
  const sameEveryDay = DAYS.every((d) => hoursKey(b.working_hours, d) === hoursKey(b.working_hours, "mon"));
  const mapUrl = `https://yandex.uz/maps/?pt=${b.longitude},${b.latitude}&z=16&l=map`;
  const routeUrl = `https://yandex.uz/maps/?rtext=~${b.latitude},${b.longitude}&rtt=auto`;
  const rangeLabel = (w: { open: string; close: string }) => `${w.open}–${w.close}${w.close <= w.open ? ` (${t("branch.nextDay")})` : ""}`;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
      <Link href="/clubs" className="text-sm text-muted hover:text-fg">
        ← {t("clubs.title")}
      </Link>
      {/* minmax(0,1fr): ichidagi gorizontal scroll (sana chiplari) sahifani kengaytirmasin */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          {/* ---------- Asosiy karta ---------- */}
          <section className="relative overflow-hidden rounded-3xl border border-line-soft bg-surface">
            {cover ? (
              <div className="relative h-52 sm:h-72">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
              </div>
            ) : (
              <div aria-hidden className="gc-hero-glow pointer-events-none absolute inset-0" />
            )}
            <div className={cx("relative space-y-5 p-5 sm:p-7", cover && "-mt-14")}>
              {fav.error && <Alert>{fav.error}</Alert>}
              <div className="flex items-start gap-4">
                {b.club.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.club.logo_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-4 ring-surface sm:h-20 sm:w-20" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-accent font-display text-3xl font-bold text-on-accent ring-4 ring-surface sm:h-20 sm:w-20 sm:text-4xl">
                    {b.club.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-[28px] font-bold leading-tight sm:text-4xl">{b.club.name}</h1>
                  <div className="mt-0.5 text-[15px] font-semibold text-muted">{t("branch.branchName", { name: b.name })}</div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Badge tone={isOpen ? "green" : "red"}>
                      {isOpen ? (openUntil ? t("branch.openUntil", { time: fmtTime(openUntil, tz) }) : t("clubs.open")) : t("clubs.closed")}
                    </Badge>
                    {b.rating_count > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs font-bold">
                        <Star className="h-3.5 w-3.5 fill-warn text-warn" />
                        {b.rating_avg.toFixed(1)} <span className="font-semibold text-muted">· {t("branch.reviewsCount", { n: b.rating_count })}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs font-bold text-muted">
                        <Sparkles className="h-3.5 w-3.5 text-accent" />
                        {t("branch.newClub")}
                      </span>
                    )}
                  </div>
                </div>
                <FavoriteButton branchId={b.id} fav={fav} className="shrink-0" />
              </div>

              {about.length > 0 && (
                <div className="space-y-1.5">
                  {about.map((text, i) => (
                    <p key={i} className={cx("whitespace-pre-line leading-relaxed", i === 0 ? "text-[15px] text-fg/90" : "text-sm text-muted")}>
                      {text}
                    </p>
                  ))}
                </div>
              )}

              {/* Tezkor ko'rsatkichlar */}
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <Fact
                  icon={Gamepad2}
                  label={t("branch.freeNow")}
                  value={s ? `${s.free_devices}/${totalDevices}` : totalDevices ? String(totalDevices) : "—"}
                  accent={!!s && s.free_devices > 0}
                />
                <Fact icon={CreditCard} label={t("branch.priceFromLabel")} value={priceFrom != null ? formatMoney(priceFrom, locale) : "—"} hint={priceFrom != null ? t("branch.perHour") : undefined} />
                <Fact icon={Clock} label={t("branch.today")} value={todayHours.length ? todayHours.map((w) => `${w.open}–${w.close}`).join(", ") : t("branch.dayOff")} />
                <Fact icon={DoorOpen} label={t("branch.roomsLabel")} value={String(b.rooms?.length ?? 0)} hint={b.rooms?.length ? t("branch.seatsTotal", { n: totalDevices }) : undefined} />
              </div>

              {/* Aloqa */}
              <div className="divide-y divide-line-soft rounded-2xl border border-line-soft bg-surface-2/60">
                <InfoRow icon={MapPin} label={t("branch.address")}>
                  <div className="font-semibold">{b.address}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-semibold hover:border-muted/60">
                      <MapPin className="h-3.5 w-3.5" />
                      {t("branch.showOnMap")}
                    </a>
                    <a href={routeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-bold text-on-accent hover:bg-accent-hover">
                      <Navigation className="h-3.5 w-3.5" />
                      {t("booking.route")}
                    </a>
                  </div>
                </InfoRow>
                {phone && (
                  <InfoRow icon={Phone} label={t("branch.phone")}>
                    <a href={`tel:${phone}`} className="font-semibold tabular-nums hover:text-accent">
                      {phone}
                    </a>
                  </InfoRow>
                )}
                {(b.club.telegram || b.club.instagram || b.club.website) && (
                  <InfoRow icon={Globe} label={t("branch.social")}>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-semibold">
                      {b.club.telegram && (
                        <a href={`https://t.me/${b.club.telegram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                          <Send className="h-3.5 w-3.5" />
                          Telegram
                        </a>
                      )}
                      {b.club.instagram && (
                        <a href={`https://instagram.com/${b.club.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                          Instagram
                        </a>
                      )}
                      {b.club.website && (
                        <a href={b.club.website} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                          {b.club.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                      )}
                    </div>
                  </InfoRow>
                )}
              </div>
            </div>
          </section>

          {/* ---------- Jihozlar va xonalar ---------- */}
          {(deviceTypes.length > 0 || (b.rooms?.length ?? 0) > 0) && (
            <Card className="space-y-4">
              <SectionTitle>{t("branch.equipment")}</SectionTitle>
              {deviceTypes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {deviceTypes.map((d) => {
                    const Icon = DEVICE_ICON[d.type] ?? Gamepad2;
                    return (
                      <span key={d.type} className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                        <Icon className="h-4 w-4 text-accent" />
                        <b>{t(`deviceType.${d.type}` as MessageKey)}</b>
                        <span className="tabular-nums text-muted">× {d.count}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {(b.rooms?.length ?? 0) > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {b.rooms!.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-3">
                      <div className="min-w-0">
                        <div className="truncate font-bold">{r.name}</div>
                        {t(`roomType.${r.type}` as MessageKey).toLowerCase() !== r.name.toLowerCase() && <div className="text-xs text-muted">{t(`roomType.${r.type}` as MessageKey)}</div>}
                      </div>
                      {r.capacity != null && <span className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-bold tabular-nums">{t("branch.seatsTotal", { n: r.capacity })}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* ---------- Ish vaqti ---------- */}
            <Card className="space-y-3">
              <SectionTitle>{t("branch.hours")}</SectionTitle>
              {sameEveryDay ? (
                <div className="rounded-xl bg-surface-2 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted">{t("branch.everyDay")}</div>
                  <div className="mt-1 font-display text-xl font-bold tabular-nums">{todayHours.length ? todayHours.map(rangeLabel).join(", ") : t("branch.dayOff")}</div>
                </div>
              ) : (
                <ul className="space-y-1 text-sm">
                  {DAYS.map((d) => (
                    <li key={d} className={cx("flex justify-between rounded-lg px-2.5 py-1.5", d === today ? "bg-accent/10 font-bold text-accent" : "")}>
                      <span className={d === today ? "" : "text-muted"}>
                        {t(`weekday.${d}` as MessageKey)}
                        {d === today && ` · ${t("branch.todayShort")}`}
                      </span>
                      <span className="tabular-nums">{b.working_hours[d]?.length ? b.working_hours[d].map(rangeLabel).join(", ") : t("branch.dayOff")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* ---------- Narxlar ---------- */}
            <Card className="space-y-3">
              <SectionTitle>{t("branch.prices")}</SectionTitle>
              {tariffs.data?.length === 0 && <div className="text-sm text-muted">{t("branch.noPrices")}</div>}
              <ul className="space-y-2">
                {tariffs.data?.map((tr) => (
                  <li key={tr.id} className="rounded-xl bg-surface-2 px-3.5 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-sm font-semibold">{tr.name}</span>
                      <span className="shrink-0 tabular-nums">
                        <b className="font-display text-base text-accent">{formatMoney(tr.price_per_hour, locale)}</b>
                        <span className="text-xs text-muted">/{t("branch.hour")}</span>
                      </span>
                    </div>
                    {tr.rules.map((r, i) => (
                      <div key={i} className="mt-1 flex justify-between text-xs text-muted">
                        <span>
                          {t(`tariffKind.${r.kind}` as MessageKey)} {r.start_time}–{r.end_time}
                        </span>
                        <span className="tabular-nums">{formatMoney(r.price_per_hour, locale)}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* ---------- Uyga arenda ---------- */}
          {(rentals.data?.length ?? 0) > 0 && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <SectionTitle>{t("rent.clubSection")}</SectionTitle>
                  <p className="text-sm text-muted">{t("rent.clubSectionHint")}</p>
                </div>
                <Link href="/rentals" className="text-sm font-bold text-accent hover:underline">
                  {t("rent.allRentals")}
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {rentals.data?.map((it) => (
                  <RentalCard key={it.id} item={it} showClub={false} />
                ))}
              </div>
            </section>
          )}

          {/* ---------- Qulayliklar va to'lov ---------- */}
          {(amenities.length > 0 || b.payment_options) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {amenities.length > 0 && (
                <Card className="space-y-3">
                  <SectionTitle>{t("branch.amenities")}</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {amenities.map((a) => {
                      const Icon = AMENITY_ICON[a] ?? Sparkles;
                      return (
                        <span key={a} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-semibold">
                          <Icon className="h-3.5 w-3.5 text-accent" />
                          {AMENITIES.has(a) ? t(`amenity.${a}` as MessageKey) : a}
                        </span>
                      );
                    })}
                  </div>
                </Card>
              )}
              {b.payment_options && (
                <Card className="space-y-3">
                  <SectionTitle>{t("branch.payment")}</SectionTitle>
                  <ul className="space-y-2 text-sm">
                    <PayRow icon={CreditCard} on={b.payment_options.card_transfer} title={t("ticket.method.CARD_TRANSFER")} />
                    <PayRow icon={Store} on={b.payment_options.pay_at_club} title={t("branch.pay.atClub")} />
                  </ul>
                </Card>
              )}
            </div>
          )}

          {b.club.rules && (
            <Card className="space-y-2">
              <SectionTitle>{t("branch.rules")}</SectionTitle>
              <p className="whitespace-pre-line text-sm leading-relaxed text-fg/85">{b.club.rules}</p>
            </Card>
          )}

          <BranchReviews branchId={b.id} timezone={b.timezone} />
        </div>
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <BookingWidget branch={b} />
        </div>
      </div>
    </main>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg font-bold">{children}</h2>;
}

function Fact({ icon: Icon, label, value, hint, accent }: { icon: LucideIcon; label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className={cx("mt-1 font-display text-lg font-bold leading-tight tabular-nums [overflow-wrap:anywhere]", accent && "text-accent")}>{value}</div>
      {hint && <div className="truncate text-xs text-muted">{hint}</div>}
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-4 py-3.5">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 text-[15px]">
        <div className="text-xs text-muted">{label}</div>
        {children}
      </div>
    </div>
  );
}

function PayRow({ icon: Icon, on, title }: { icon: LucideIcon; on: boolean; title: string }) {
  return (
    <li className={cx("flex items-center gap-2.5 rounded-xl px-3 py-2.5", on ? "bg-surface-2" : "text-muted line-through opacity-60")}>
      <Icon className={cx("h-4 w-4", on ? "text-accent" : "")} />
      <span className="font-semibold">{title}</span>
    </li>
  );
}
