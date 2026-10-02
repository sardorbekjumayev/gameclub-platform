"use client";

import Link from "next/link";
import { useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { Alert, Button, Spinner } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";
import type { Favorite } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <Favorites />
    </RequireAuth>
  );
}

/** Sevimli filiallar (GET /favorites). */
function Favorites() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const { data, loading, error, reload, setData } = useApi<Favorite[]>("/favorites");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function remove(branchId: string) {
    setBusy(branchId);
    setMsg(null);
    try {
      await session.delete(`/favorites/${branchId}`);
      setData((d) => d?.filter((f) => f.branch_id !== branchId) ?? null);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-4 py-8 sm:px-8">
      <h1 className="font-display text-3xl font-bold">{t("favorites.title")}</h1>
      {msg && <Alert>{msg}</Alert>}
      {loading && <Spinner className="mx-auto my-10 h-6 w-6" />}
      {error && (
        <Alert>
          {error}{" "}
          <button className="underline" onClick={reload}>
            {t("map.retry")}
          </button>
        </Alert>
      )}
      {!loading && !error && data?.length === 0 && (
        <div className="space-y-2 rounded-2xl border border-dashed border-line py-12 text-center text-muted">
          <div>{t("favorites.empty")}</div>
          <Link href="/clubs" className="font-semibold text-accent hover:underline">
            {t("bookings.findClub")}
          </Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!loading &&
          data?.map(({ branch: b }) => {
            const img = b.cover_url ?? b.club.logo_url;
            return (
              <div key={b.id} className="overflow-hidden rounded-[18px] bg-surface">
                <Link href={`/clubs/${b.id}`} className="block transition hover:bg-surface-2">
                  <div className="h-32 bg-surface-3">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center font-display text-3xl font-bold text-line">{b.club.name.slice(0, 2).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="space-y-1 p-4 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold">{b.club.name}</div>
                      {b.rating_count > 0 && <span className="shrink-0 text-sm">★ {b.rating_avg.toFixed(1)}</span>}
                    </div>
                    <div className="text-sm text-muted">
                      {b.name} · {b.address}
                    </div>
                    {(b.status !== "ACTIVE" || b.club.status !== "ACTIVE") && <div className="text-xs text-danger-soft">{t("favorites.inactive")}</div>}
                  </div>
                </Link>
                <div className="px-4 pb-4">
                  <Button variant="ghost" size="sm" loading={busy === b.id} onClick={() => remove(b.id)}>
                    ♥ {t("favorites.remove")}
                  </Button>
                </div>
              </div>
            );
          })}
      </div>
    </main>
  );
}
