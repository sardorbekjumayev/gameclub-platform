"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { useErrorText, useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";
import type { Favorite } from "@/lib/types";

/** Kirgan foydalanuvchining sevimli filiallari (GET /favorites) — id to'plami + toggle. */
export function useFavorites() {
  const { me } = useAuth();
  const errorText = useErrorText();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    session.get<Favorite[]>("/favorites").then(
      (r) => alive && setIds(new Set(r.data.map((f) => f.branch_id))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [me]);

  const toggle = useCallback(
    async (branchId: string) => {
      const on = ids.has(branchId);
      setBusy(branchId);
      setError(null);
      try {
        if (on) await session.delete(`/favorites/${branchId}`);
        else await session.put(`/favorites/${branchId}`);
        setIds((prev) => {
          const next = new Set(prev);
          if (on) next.delete(branchId);
          else next.add(branchId);
          return next;
        });
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(null);
      }
    },
    [ids, errorText],
  );

  return { loggedIn: !!me, ids, busy, error, toggle };
}

/** Yurakcha: kirgan bo'lsa toggle, aks holda /login?next=... (karta Link ichida bo'lgani uchun doim button). */
export function FavoriteButton({
  branchId,
  fav,
  className,
}: {
  branchId: string;
  fav: ReturnType<typeof useFavorites>;
  className?: string;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const on = fav.ids.has(branchId);
  const label = on ? t("favorites.remove") : t("favorites.add");
  const cls = cx(
    "inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface/90 text-lg leading-none transition hover:border-muted/60 disabled:opacity-50",
    on ? "text-danger-soft" : "text-muted",
    className,
  );
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={fav.busy === branchId}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (fav.loggedIn) void fav.toggle(branchId);
        else router.push(`/login?next=${encodeURIComponent(pathname)}`);
      }}
    >
      {on ? "♥" : "♡"}
    </button>
  );
}
