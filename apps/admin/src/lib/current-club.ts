"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./session";
import type { MyClub } from "./types";
import { useApi } from "./use-api";

const KEY = "gc.club";
const listeners = new Set<(id: string) => void>();

/** Panelda tanlangan joriy klub (bir nechta klub bo'lsa) — sidebar va dashboard uchun umumiy. */
export function useCurrentClub() {
  const { me, loading: authLoading } = useAuth();
  // Kirmagan foydalanuvchi uchun so'rov yubormaymiz (aks holda har safar 401)
  const res = useApi<MyClub[]>(me ? "/clubs/mine" : null);
  const loading = authLoading || (!!me && res.loading) || (!!me && res.data === null && res.error === null);
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const on = (id: string) => setPicked(id);
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);

  const clubs = res.data ?? [];
  const club = clubs.find((c) => c.id === picked) ?? clubs[0] ?? null;

  const select = (id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* storage yo'q */
    }
    listeners.forEach((l) => l(id));
  };

  return { ...res, loading, clubs, club, select };
}
