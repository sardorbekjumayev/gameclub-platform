"use client";

import { useParams } from "next/navigation";
import { AnnouncementsManager } from "@/components/announcements";
import { ClubHeader } from "@/components/club-tabs";

const AUDIENCES = ["CLUB_CUSTOMERS", "ALL"] as const;

/** Klub e'lonlari (klub mijozlariga). */
export default function ClubAnnouncementsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  return (
    <div className="space-y-5">
      <ClubHeader clubId={clubId} />
      <AnnouncementsManager
        listPath={`/clubs/${clubId}/announcements`}
        basePath={`/clubs/${clubId}/announcements`}
        permission="announcements.manage"
        audiences={AUDIENCES}
      />
    </div>
  );
}
