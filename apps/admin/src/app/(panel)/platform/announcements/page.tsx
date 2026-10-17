"use client";

import { AnnouncementsManager } from "@/components/announcements";
import { Heading } from "@/components/ui";
import { useI18n } from "@/i18n/provider";

const AUDIENCES = ["ALL", "CUSTOMERS", "STAFF"] as const;

/** Super admin: platforma broadcastlari (barcha foydalanuvchilarga). */
export default function PlatformAnnouncementsPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <Heading>{t("nav.announcements")}</Heading>
      <AnnouncementsManager listPath="/announcements" basePath="/admin/broadcasts" permission="platform.announcements.manage" audiences={AUDIENCES} />
    </div>
  );
}
