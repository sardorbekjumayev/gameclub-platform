"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { session } from "@/lib/session";

export const LEAD_STATUSES = ["NEW", "CONTACTED", "APPROVED", "REJECTED"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** zonup.uz → "Klub ochish" formasidan kelgan ulanish arizasi (`/admin/club-applications`). */
export type ClubLead = {
  id: string;
  full_name: string;
  phone: string;
  club_name: string;
  city: string;
  address: string | null;
  devices_count: number | null;
  branches_count: number | null;
  telegram: string | null;
  comment: string | null;
  language: string;
  status: LeadStatus;
  admin_note: string | null;
  handled_at: string | null;
  created_at: string;
};
export type ClubLeadDetail = ClubLead & { handler: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null };

const TONE: Record<LeadStatus, "amber" | "violet" | "green" | "neutral"> = { NEW: "amber", CONTACTED: "violet", APPROVED: "green", REJECTED: "neutral" };

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const { t } = useI18n();
  return <Badge tone={TONE[status]}>{t(`leads.status.${status}` as MessageKey)}</Badge>;
}

/** Super admin menyusidagi yangi (ko'rilmagan) arizalar soni; sahifa almashganda va har daqiqada yangilanadi. */
export function useNewClubLeads(enabled: boolean, pathname: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      session.get<{ new: number }>("/admin/club-applications/stats").then(
        (r) => alive && setN(r.data.new),
        () => undefined,
      );
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, pathname]);
  return enabled ? n : 0;
}
