"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Heading, Stat } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/session";

export default function Dashboard() {
  const { me } = useAuth();
  const { t } = useI18n();
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ status: string }>("/health/ready")
      .then((r) => setApiOk(r.data.status === "ok"))
      .catch(() => setApiOk(false));
  }, []);

  if (!me) return null;
  const name = me.first_name || me.email || me.phone || "";

  return (
    <div className="space-y-[22px]">
      <Heading>{t("dashboard.welcome", { name })}</Heading>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl p-[18px]">
          <div className="text-[13px] text-muted">{t("dashboard.roles")}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {me.roles.map((r) => (
              <Badge key={`${r.role}-${r.club_id}-${r.branch_id}`} tone="violet">
                {r.role}
              </Badge>
            ))}
          </div>
        </Card>
        <Stat label={t("dashboard.permissions")} value={me.permissions.length} accent />
        <Card className="rounded-2xl p-[18px]">
          <div className="text-[13px] text-muted">{t("dashboard.api")}</div>
          <div className="mt-2">
            {apiOk === null ? "…" : <Badge tone={apiOk ? "green" : "red"}>{apiOk ? t("system.ok") : t("system.down")}</Badge>}
          </div>
        </Card>
      </div>
      <Card className="border border-line text-sm text-muted">{t("dashboard.next")}</Card>
    </div>
  );
}
