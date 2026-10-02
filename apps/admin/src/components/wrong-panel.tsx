"use client";

import { ArrowRight, Building2, MonitorPlay, ShieldCheck, ShieldX } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Card, Logo } from "@/components/ui";
import { type MessageKey, useI18n } from "@/i18n/provider";
import { type PanelKind, availablePanels, panelUrl } from "@/lib/panel";
import { useAuth } from "@/lib/session";

export const PANEL_ICON: Record<PanelKind, typeof Building2> = { platform: ShieldCheck, club: Building2, desk: MonitorPlay };

/** Foydalanuvchi roli bu panelga mos kelmaydi — to'g'ri panel(lar)ga yo'naltiramiz. */
export function WrongPanel() {
  const { t } = useI18n();
  const { me, signOut } = useAuth();
  const router = useRouter();
  const panels = me ? availablePanels(me) : [];
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
        <div className="space-y-2">
          {panels.map((k) => {
            const Icon = PANEL_ICON[k];
            return (
              <a key={k} href={panelUrl(k)} className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2 p-3 transition hover:border-accent/50">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <div className="font-bold">{t(`panel.${k}` as MessageKey)}</div>
                  <div className="text-xs text-muted">{t(`panel.${k}.desc` as MessageKey)}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted" />
              </a>
            );
          })}
          {panels.length === 0 && <div className="text-sm text-muted">{t("auth.noAccess")}</div>}
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
