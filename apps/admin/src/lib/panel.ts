import type { Me } from "@gc/types";

/**
 * Bitta kod bazasidan uchta alohida panel quriladi (har biri o'z portida):
 *  - platform (4720) — SUPER_ADMIN / SUPPORT: klub arizalari, tariflar, foydalanuvchilar, payout.
 *  - club     (4730) — CLUB_OWNER / CLUB_ADMIN: klub, filiallar, qurilmalar, xodimlar, analitika.
 *  - desk     (4740) — BRANCH_ADMIN / OPERATOR: live board, bronlar, qurilmalar holati, smena.
 * Panel `NEXT_PUBLIC_PANEL` orqali build vaqtida tanlanadi.
 */
export type PanelKind = "platform" | "club" | "desk";

export const PANEL: PanelKind = ((): PanelKind => {
  const v = process.env.NEXT_PUBLIC_PANEL;
  return v === "platform" || v === "desk" ? v : "club";
})();

export const PANELS: Record<PanelKind, { port: number; roles: string[] }> = {
  platform: { port: 4720, roles: ["SUPER_ADMIN", "SUPPORT"] },
  club: { port: 4730, roles: ["CLUB_OWNER", "CLUB_ADMIN", "SUPER_ADMIN"] },
  desk: { port: 4740, roles: ["BRANCH_ADMIN", "OPERATOR", "CLUB_OWNER", "CLUB_ADMIN", "SUPER_ADMIN"] },
};

/** Panel manzili: env'dan (`NEXT_PUBLIC_PANEL_URL_<KIND>`) yoki joriy host + panel porti. */
export function panelUrl(kind: PanelKind): string {
  const env = {
    platform: process.env.NEXT_PUBLIC_PANEL_URL_PLATFORM,
    club: process.env.NEXT_PUBLIC_PANEL_URL_CLUB,
    desk: process.env.NEXT_PUBLIC_PANEL_URL_DESK,
  }[kind];
  if (env) return env;
  if (typeof window === "undefined") return `http://localhost:${PANELS[kind].port}`;
  return `${window.location.protocol}//${window.location.hostname}:${PANELS[kind].port}`;
}

export const canUsePanel = (me: Me, kind: PanelKind) => me.roles.some((r) => PANELS[kind].roles.includes(r.role));

/** Foydalanuvchi kira oladigan panellar (asosiysi birinchi). */
export const availablePanels = (me: Me) => (["platform", "club", "desk"] as const).filter((k) => canUsePanel(me, k));

/** Joriy panelda ochib bo'lmaydigan yo'llar. */
export function isPathAllowed(pathname: string): boolean {
  if (PANEL === "platform") return !pathname.startsWith("/clubs") && !pathname.startsWith("/live");
  if (PANEL === "club") return !pathname.startsWith("/platform");
  // desk: faqat operatsion bo'limlar
  if (pathname.startsWith("/platform") || pathname === "/clubs/new") return false;
  return true;
}

/** Platforma xodimi (SUPER_ADMIN/SUPPORT) klub ochmaydi va egasi bo'lolmaydi — klublarni platforma panelidan boshqaradi. */
export const isPlatformStaff = (me: Me | null | undefined) => !!me?.roles.some((r) => PANELS.platform.roles.includes(r.role));
