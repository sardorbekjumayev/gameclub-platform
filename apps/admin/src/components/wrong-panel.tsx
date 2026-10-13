"use client";

import { Building2, MonitorPlay, ShieldCheck, ShieldX } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Card, Logo } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { PanelKind } from "@/lib/panel";
import { useAuth } from "@/lib/session";

export const PANEL_ICON: Record<PanelKind, typeof Building2> = { platform: ShieldCheck, club: Building2, desk: MonitorPlay };

/** Foydalanuvchi roli bu panelga mos kelmaydi. Panellar mustaqil (har biri o'z domenida) — boshqasiga havola bermaymiz. */
export function WrongPanel() {
  const { t } = useI18n();
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-5 px-4 py-10">
      <Logo />
      <Card className="space-y-4 border border-line">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-warn/10 text-warn">
            <ShieldX className="h-5 w-5" />
          </span>
          <div>
            <div className="font-display text-lg font-bold">{t("panel.wrong.title")}</div>
            <div className="text-sm text-muted">{t("panel.wrong.text")}</div>
          </div>
        </div>
        <Button
          variant="secondary"
          className="w-full"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          {t("auth.logout")}
        </Button>
      </Card>
    </main>
  );
}
