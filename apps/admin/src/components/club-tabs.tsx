"use client";

import { BarChart3, Building2, CreditCard, Gamepad2, LayoutGrid, type LucideIcon, MapPin, Megaphone, Monitor, Star, Tags, TicketPercent, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import { StatusBadge } from "@/components/status";
import { Heading, cx } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { useMyClub } from "@/lib/my-club";

export const CLUB_TABS: { seg: string; label: MessageKey; permission: string; icon: LucideIcon }[] = [
  { seg: "", label: "club.tab.profile", permission: "clubs.view", icon: Building2 },
  { seg: "/branches", label: "club.tab.branches", permission: "branches.view", icon: MapPin },
  { seg: "/devices", label: "club.tab.devices", permission: "devices.view", icon: Monitor },
  { seg: "/layout", label: "club.tab.layout", permission: "devices.view", icon: LayoutGrid },
  { seg: "/tariffs", label: "club.tab.tariffs", permission: "tariffs.view", icon: Tags },
  { seg: "/rentals", label: "club.tab.rentals", permission: "rentals.view", icon: Gamepad2 },
  { seg: "/promotions", label: "club.tab.promotions", permission: "promotions.view", icon: TicketPercent },
  { seg: "/payments", label: "club.tab.payments", permission: "settings.view", icon: CreditCard },
  { seg: "/staff", label: "club.tab.staff", permission: "staff.view", icon: Users },
  { seg: "/analytics", label: "club.tab.analytics", permission: "reports.view", icon: BarChart3 },
  { seg: "/reviews", label: "club.tab.reviews", permission: "reviews.view", icon: Star },
  { seg: "/announcements", label: "club.tab.announcements", permission: "announcements.manage", icon: Megaphone },
];

/** Rol uchun klubning birinchi ochiq bo'limi (operator → qurilmalar). */
export function firstClubTab(clubId: string, can: (p: string) => boolean) {
  const tab = CLUB_TABS.find((t) => can(t.permission)) ?? CLUB_TABS[0];
  return `/clubs/${clubId}${tab.seg}`;
}

/** Klub bo'limi sarlavhasi. Bo'limlar navigatsiyasi sidebar'da (panel layout). */
export function ClubHeader({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { club } = useMyClub(clubId);
  const tab = CLUB_TABS.find((x) => pathname === `/clubs/${clubId}${x.seg}`);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {tab && (
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">
          <tab.icon className="h-5 w-5" />
        </span>
      )}
      <div>
        {tab && <div className="text-xs font-semibold uppercase tracking-widest text-muted">{t(tab.label)}</div>}
        <Heading>{club?.name ?? "…"}</Heading>
      </div>
      {club && <StatusBadge status={club.status} />}
    </div>
  );
}

/** Filial tanlagich (chip'lar). */
export function BranchPicker({ branches, value, onChange }: { branches: { id: string; name: string }[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {branches.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onChange(b.id)}
          className={cx(
            "h-9 rounded-full px-3.5 text-[13px] transition",
            value === b.id ? "bg-accent font-bold text-on-accent" : "border border-line bg-surface font-semibold text-fg hover:border-muted/60",
          )}
        >
          {b.name}
        </button>
      ))}
    </div>
  );
}
