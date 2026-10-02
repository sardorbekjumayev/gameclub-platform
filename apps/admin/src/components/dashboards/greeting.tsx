"use client";

import { useI18n } from "@/i18n/provider";
import { useAuth } from "@/lib/session";

/** Dashboard sarlavhasi: salomlashuv + qisqa izoh. */
export function Greeting({ subtitle, children }: { subtitle: string; children?: React.ReactNode }) {
  const { t } = useI18n();
  const { me } = useAuth();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", timeZone: "Asia/Tashkent" }).format(new Date()));
  const part = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "day" : "evening";
  const name = me?.first_name || me?.email || "";
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-bold leading-tight">{t(`greet.${part}` as never, { name })}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
