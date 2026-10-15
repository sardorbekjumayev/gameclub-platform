"use client";

import { useState } from "react";
import { PromotionsManager } from "@/components/promotions";
import { Chip, Field, Heading, Select } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { useApi } from "@/lib/use-api";

type ClubOpt = { id: string; name: string };
type View = "PLATFORM" | "CLUBS";

/**
 * Super admin: platforma promo kodlari (platforma hisobidan, barcha klublarda) va klublar promo kodlari.
 * Klub tanlansa — shu klub nomidan qo'shiladi (klub hisobidan, faqat shu klubda; klub egasi ham ko'radi va tahrirlaydi).
 */
export default function PlatformPromotionsPage() {
  const { t } = useI18n();
  const [view, setView] = useState<View>("PLATFORM");
  const [clubId, setClubId] = useState("");
  const clubs = useApi<ClubOpt[]>("/admin/clubs?limit=100&status=ACTIVE");

  const listPath = view === "PLATFORM" ? "/admin/promotions?scope=PLATFORM" : clubId ? `/admin/promotions?club_id=${clubId}` : "/admin/promotions?scope=CLUBS";
  const createPath = view === "PLATFORM" ? "/admin/promotions" : clubId ? `/clubs/${clubId}/promotions` : null;

  return (
    <div className="space-y-5">
      <div>
        <Heading>{t("promo.title")}</Heading>
        <p className="mt-1 text-sm text-muted">{t("promo.platformSubtitle")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Chip active={view === "PLATFORM"} onClick={() => setView("PLATFORM")}>
          {t("promo.viewPlatform")}
        </Chip>
        <Chip active={view === "CLUBS"} onClick={() => setView("CLUBS")}>
          {t("promo.viewClubs")}
        </Chip>
        {view === "CLUBS" && (
          <Field label={t("promo.club")}>
            <Select value={clubId} onChange={(e) => setClubId(e.target.value)}>
              <option value="">{t("promo.allClubs")}</option>
              {clubs.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <PromotionsManager
        key={listPath}
        listPath={listPath}
        createPath={createPath}
        canManage
        showClub={view === "CLUBS"}
        createHint={t("promo.pickClubHint")}
      />
    </div>
  );
}
