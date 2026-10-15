"use client";

import { useParams } from "next/navigation";
import { ClubHeader } from "@/components/club-tabs";
import { PromotionsManager } from "@/components/promotions";
import { useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

/** Klub promo kodlari: klub egasi/admini qo'shadi; super admin ham shu klub uchun qo'sha oladi. */
export default function ClubPromotionsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      <p className="text-sm text-muted">{t("promo.clubSubtitle")}</p>
      <PromotionsManager listPath={`/clubs/${clubId}/promotions`} createPath={`/clubs/${clubId}/promotions`} canManage={can("promotions.manage")} />
    </div>
  );
}
