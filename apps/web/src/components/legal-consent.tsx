"use client";

import Link from "next/link";
import { Fragment } from "react";
import { cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { LegalDoc } from "@/lib/legal";

const LINK_LABEL = { offer: "legal.consent.offer", privacy: "legal.consent.privacy", terms: "legal.consent.terms" } as const;

/**
 * Rozilik qatori: "Davom etish orqali siz Ommaviy oferta va Maxfiylik siyosatiga rozilik bildirasiz".
 * Havolalar yangi oynada ochiladi — bron/login formasidagi tanlov yo'qolmasin.
 */
export function LegalConsent({ kind, className }: { kind: "login" | "booking" | "pay"; className?: string }) {
  const { t } = useI18n();
  const parts = t(`legal.consent.${kind}`).split(/(\{offer\}|\{privacy\}|\{terms\})/);
  return (
    <p className={cx("text-center text-xs leading-5 text-muted", className)}>
      {parts.map((p, i) => {
        const doc = p.match(/^\{(offer|privacy|terms)\}$/)?.[1] as Exclude<LegalDoc, "partner"> | undefined;
        if (!doc) return <Fragment key={i}>{p}</Fragment>;
        return (
          <Link key={i} href={`/legal/${doc}`} target="_blank" className="font-semibold text-fg underline decoration-line underline-offset-2 hover:text-accent">
            {t(LINK_LABEL[doc])}
          </Link>
        );
      })}
    </p>
  );
}
