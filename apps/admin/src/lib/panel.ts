import type { Me } from "@gc/types";

/**
 * Bitta kod bazasidan uchta mustaqil panel quriladi (dev: o'z porti, prod: o'z subdomeni; bir-biriga havola bermaydi):
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

export const PANELS: Record<PanelKind, { roles: string[] }> = {
  platform: { roles: ["SUPER_ADMIN", "SUPPORT"] },
  club: { roles: ["CLUB_OWNER", "CLUB_ADMIN", "SUPER_ADMIN"] },
  desk: { roles: ["BRANCH_ADMIN", "OPERATOR", "CLUB_OWNER", "CLUB_ADMIN", "SUPER_ADMIN"] },
};

export const canUsePanel = (me: Me, kind: PanelKind) => me.roles.some((r) => PANELS[kind].roles.includes(r.role));

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
