"use client";

import { formatMoney } from "@gc/types";
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { Card } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { session, useAuth } from "@/lib/session";

type ActiveSession = {
  id: string;
  status: "WAITING" | "ACTIVE" | "PAUSED";
  expected_end_at: string | null;
  remaining_seconds: number | null;
  amount_due: number;
  /** VIP (ochiq vaqt): o'ynalgan soniyalar va hozirgacha summa (server hisobi) */
  is_open?: boolean;
  elapsed_seconds?: number | null;
  accrued_amount?: number | null;
  server_time: string;
  device: { name: string } | null;
  branch: { name: string; address: string; club: { name: string } } | null;
};

const clock = (sec: number) => {
  const a = Math.max(0, sec);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(a / 3600))}:${p(Math.floor((a % 3600) / 60))}:${p(a % 60)}`;
};

/**
 * Mijozning faol sessiyalari (Phase 7): `GET /sessions/active` + `user:{id}` WebSocket xonasi
 * (server avtomatik qo'shadi) — operator uzaytirsa/to'xtatsa darhol yangilanadi.
 */
export function ActiveSessions() {
  const { t, locale } = useI18n();
  const { me } = useAuth();
  const [rows, setRows] = useState<ActiveSession[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(0);

  const load = useCallback(() => {
    session.get<ActiveSession[]>("/sessions/active").then(
      (r) => {
        setRows(r.data);
        setFetchedAt(Date.now());
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!me) return;
    load();
    const socket = io({ path: "/api/v1/ws", addTrailingSlash: false, auth: (done) => done({ token: session.accessToken() }), transports: ["polling", "websocket"] });
    ["session.started", "session.updated", "session.ended"].forEach((e) => socket.on(e, load));
    socket.on("error", async (e: { code?: string }) => {
      if (e?.code === "UNAUTHORIZED" && (await session.refresh())) socket.connect();
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, 60_000);
    return () => {
      socket.close();
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [me, load]);

  if (!me || rows.length === 0) return null;

  return (
    <section className="mb-8 space-y-3">
      <h2 className="font-display text-2xl font-bold">{t("session.active")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((s) => {
          const elapsed = s.status === "PAUSED" || !now ? 0 : Math.round((now - fetchedAt) / 1000);
          const left = s.remaining_seconds === null ? null : s.remaining_seconds - elapsed;
          if (s.is_open) {
            return (
              <Card key={s.id} className="space-y-2 border border-accent">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{s.branch?.club.name}</span>
                  <span className="text-sm text-muted">{s.device?.name}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent">VIP</span>
                  {s.branch?.name}
                </div>
                <div className="font-display text-4xl font-bold tabular-nums text-accent">{clock((s.elapsed_seconds ?? 0) + elapsed)}</div>
                <div className="text-xs text-muted">{s.status === "PAUSED" ? t("session.paused") : t("session.vipPlayed")}</div>
                <div className="text-sm font-bold">{t("session.vipAccrued", { amount: formatMoney(s.accrued_amount ?? 0, locale) })}</div>
                <div className="text-xs text-muted">{t("session.vipHint")}</div>
              </Card>
            );
          }
          return (
            <Card key={s.id} className="space-y-2 border border-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{s.branch?.club.name}</span>
                <span className="text-sm text-muted">{s.device?.name}</span>
              </div>
              <div className="text-sm text-muted">{s.branch?.name}</div>
              <div className={`font-display text-4xl font-bold tabular-nums ${left !== null && left < 600 ? "text-warn" : "text-accent"}`}>{left === null ? "—" : clock(left)}</div>
              <div className="text-xs text-muted">{s.status === "PAUSED" ? t("session.paused") : t("session.remaining")}</div>
              {s.amount_due > 0 && <div className="text-sm font-bold text-warn">{t("session.due", { amount: formatMoney(s.amount_due, locale) })}</div>}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
