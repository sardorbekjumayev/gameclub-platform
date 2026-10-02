"use client";

import type { MyClub } from "./types";
import { useApi } from "./use-api";

/**
 * Joriy klub (sarlavha, filiallar) — `/clubs/mine` dan. Har bir rol uchun ishlaydi:
 * filial roli faqat o'z filiallarini oladi, shuning uchun filial tanlagich ham shundan.
 */
export function useMyClub(clubId: string) {
  const res = useApi<MyClub[]>("/clubs/mine");
  const club = res.data?.find((c) => c.id === clubId) ?? null;
  return { ...res, club, branches: club?.branches ?? [] };
}
