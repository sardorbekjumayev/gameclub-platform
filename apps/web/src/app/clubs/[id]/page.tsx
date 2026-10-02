"use client";

import { formatMoney } from "@gc/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookingWidget } from "@/components/booking-widget";
import { BranchReviews } from "@/components/branch-reviews";
import { FavoriteButton, useFavorites } from "@/components/favorite-button";
import { Alert, Badge, Card, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { BranchCard, BranchDetail, Tariff } from "@/lib/types";
import { useApi } from "@/lib/use-api";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Filial sahifasi (docs/01-API.md §6.7): ma'lumot, ish vaqti, tariflar, sharhlar + bron vidjeti. */
export default function BranchPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const branch = useApi<BranchDetail>(`/branches/${id}`);
  const summary = useApi<BranchCard>(`/branches/${id}/summary`);
  const tariffs = useApi<Tariff[]>(`/branches/${id}/tariffs`);
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
  const mapUrl = `https://yandex.uz/maps/?pt=${b.longitude},${b.latitude}&z=16&l=map`;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
      <Link href="/clubs" className="text-sm text-muted hover:text-fg">
        ← {t("clubs.title")}
      </Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-3xl bg-surface">
            <div className="h-48 bg-surface-3 sm:h-64">
              {b.cover_url || b.club.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(b.cover_url ?? b.club.logo_url)!} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center font-display text-6xl font-bold text-line">{b.club.name.slice(0, 2).toUpperCase()}</div>
              )}
            </div>
            <div className="space-y-3 p-6">
              {fav.error && <Alert>{fav.error}</Alert>}
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-3xl font-bold">{b.club.name}</h1>
                <FavoriteButton branchId={b.id} fav={fav} className="order-last ml-auto" />
                {s && <Badge tone={s.is_open_now ? "green" : "red"}>{s.is_open_now ? t("clubs.open") : t("clubs.closed")}</Badge>}
              </div>
              <div className="text-muted">
                {b.name} · {b.address}{" "}
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent hover:underline">
                  {t("branch.showOnMap")}
                </a>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {b.rating_count > 0 && (
                  <span>
                    ★ {b.rating_avg.toFixed(1)} <span className="text-muted">({b.rating_count})</span>
                  </span>
                )}
                {s && <span className="font-bold text-accent">{t("map.free", { n: s.free_devices })}</span>}
                {s?.price_from != null && <span>{t("map.priceFrom", { price: formatMoney(s.price_from, locale) })}</span>}
                {(b.phone ?? b.club.phone) && (
                  <a href={`tel:${b.phone ?? b.club.phone}`} className="hover:text-accent">
                    {b.phone ?? b.club.phone}
                  </a>
                )}
                {b.club.telegram && (
                  <a href={`https://t.me/${b.club.telegram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                    Telegram
                  </a>
                )}
              </div>
              {(b.description ?? b.club.description) && <p className="whitespace-pre-line text-sm text-muted">{b.description ?? b.club.description}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="space-y-2">
              <div className="font-display text-lg font-bold">{t("branch.hours")}</div>
              <ul className="space-y-1 text-sm">
                {DAYS.map((d) => (
                  <li key={d} className="flex justify-between">
                    <span className="text-muted">{t(`weekday.${d}` as never)}</span>
                    <span className="tabular-nums">{b.working_hours[d]?.length ? b.working_hours[d].map((w) => `${w.open}–${w.close}`).join(", ") : t("branch.dayOff")}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="space-y-2">
              <div className="font-display text-lg font-bold">{t("branch.prices")}</div>
              {tariffs.data?.length === 0 && <div className="text-sm text-muted">{t("branch.noPrices")}</div>}
              <ul className="space-y-2 text-sm">
                {tariffs.data?.map((tr) => (
                  <li key={tr.id}>
                    <div className="flex justify-between">
                      <span>{tr.name}</span>
                      <b className="tabular-nums">
                        {formatMoney(tr.price_per_hour, locale)}/{t("branch.hour")}
                      </b>
                    </div>
                    {tr.rules.map((r, i) => (
                      <div key={i} className="flex justify-between text-xs text-muted">
                        <span>
                          {t(`tariffKind.${r.kind}` as never)} {r.start_time}–{r.end_time}
                        </span>
                        <span className="tabular-nums">{formatMoney(r.price_per_hour, locale)}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {b.club.rules && (
            <Card className="space-y-2">
              <div className="font-display text-lg font-bold">{t("branch.rules")}</div>
              <p className="whitespace-pre-line text-sm text-muted">{b.club.rules}</p>
            </Card>
          )}

          <BranchReviews branchId={b.id} timezone={b.timezone} />
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">
          <BookingWidget branch={b} />
        </div>
      </div>
    </main>
  );
}
