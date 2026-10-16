"use client";

import Link from "next/link";
import { SocialLinks, useSocial } from "@/components/social";
import { useI18n } from "@/i18n/provider";
import { LEGAL_DOCS, LEGAL_LABEL } from "@/lib/legal";

/** Har sahifadagi footer: bo'limlar, ijtimoiy tarmoqlar va huquqiy hujjatlar. */
export function SiteFooter() {
  const { t } = useI18n();
  const social = useSocial();
  return (
    <footer className="mt-auto border-t border-line-soft">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 text-sm text-muted sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3">
            <span>
              © {new Date().getFullYear()} Zonup · <span className="font-semibold text-fg">zonup.uz</span> · {t("home.footer")}
            </span>
            <SocialLinks social={social} size="sm" />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/clubs" className="hover:text-fg">
              {t("nav.clubs")}
            </Link>
            <Link href="/map" className="hover:text-fg">
              {t("nav.map")}
            </Link>
            <Link href="/for-clubs" className="hover:text-fg">
              {t("home.owner.cta")}
            </Link>
          </div>
        </div>
        <nav aria-label={t("legal.nav")} className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line-soft pt-4 text-xs">
          {LEGAL_DOCS.map((d) => (
            <Link key={d} href={`/legal/${d}`} className="hover:text-fg">
              {t(LEGAL_LABEL[d])}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
