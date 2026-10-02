"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { session } from "./session";

export type LiveStatus = "connecting" | "live" | "offline";

const LIVE_EVENTS = [
  "device.status.changed",
  "booking.created",
  "booking.updated",
  "booking.cancelled",
  "session.started",
  "session.updated",
  "session.ended",
  "payment.completed",
] as const;

/**
 * Filial xonasiga (`branch:{id}`) obuna — docs/01-API.md §9.
 * Har event yoki qayta ulanishda `onChange` chaqiriladi; klient snapshot'ni REST'dan qayta oladi.
 * Yo'l `/api/v1/ws` — Next rewrite orqali (polling; websocket upgrade mumkin bo'lsa).
 */
export function useLiveBranch(branchId: string | null, onChange: () => void) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    if (!branchId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Ketma-ket eventlar (masalan session.started + device.status.changed) bitta so'rovga yig'iladi
    const changed = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 250);
    };
    const socket: Socket = io({
      path: "/api/v1/ws",
      addTrailingSlash: false,
      auth: (done) => done({ token: session.accessToken() }),
      transports: ["polling", "websocket"],
    });
    const subscribe = async () => {
      const res = await socket.emitWithAck("subscribe", { room: `branch:${branchId}` }).catch(() => null);
      setStatus(res?.ok ? "live" : "offline");
      changed();
    };
    socket.on("connect", subscribe);
    socket.on("disconnect", () => setStatus("offline"));
    socket.on("connect_error", () => setStatus("offline"));
    // Server token muddati o'tganini aytsa — refresh va qayta ulanish
    socket.on("error", async (e: { code?: string }) => {
      if (e?.code === "UNAUTHORIZED" && (await session.refresh())) socket.connect();
    });
    LIVE_EVENTS.forEach((ev) => socket.on(ev, changed));
    return () => {
      if (timer) clearTimeout(timer);
      socket.close();
    };
  }, [branchId]);

  return status;
}
