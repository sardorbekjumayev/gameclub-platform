"use client";

import { useCallback, useEffect, useState } from "react";
import { useErrorText } from "@/i18n/provider";
import { session } from "./session";

/** GET so'rovi uchun loading/error/data holatlari. `path` null bo'lsa so'rov yuborilmaydi. */
export function useApi<T>(path: string | null) {
  const errorText = useErrorText();
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<{ total?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    session.get<T>(path).then(
      (res) => {
        if (!alive) return;
        setData(res.data);
        setMeta((res.meta as { total?: number }) ?? null);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (!alive) return;
        setError(errorText(e));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => {
    setLoading(true);
    setKey((k) => k + 1);
  }, []);

  return { data, meta, error, loading, reload, setData };
}

export const normalizePhone = (v: string) => {
  const digits = v.replace(/\D/g, "");
  if (digits.length === 9) return `+998${digits}`;
  return `+${digits}`;
};

/** Takroriy yuborishdan himoya uchun Idempotency-Key. */
export const idemKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
