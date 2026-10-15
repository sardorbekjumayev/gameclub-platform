"use client";

import { formatDateTime } from "@gc/types";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { Alert, Button, Heading, Spinner, cx } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { LEGAL_DOCS, LEGAL_LABEL, type LegalDoc, type LegalDocData, type LegalLang } from "@/lib/legal";
import { useApi } from "@/lib/use-api";

/** Hujjat tanlangan tilda; server bergan matn bo'lmasa (API vaqtincha ishlamagan) — brauzerdan so'raladi. */
export function LegalView({ doc, initial }: { doc: LegalDoc; initial: Record<LegalLang, LegalDocData | null> }) {
  const { t, locale } = useI18n();
  const fallback = useApi<LegalDocData>(initial[locale] ? null : `/legal/${doc}?lang=${locale}`);
  const data = initial[locale] ?? fallback.data;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
      <nav className="mb-6 flex flex-wrap gap-2" aria-label={t("legal.nav")}>
        {LEGAL_DOCS.map((d) => (
          <Link
            key={d}
            href={`/legal/${d}`}
            className={cx(
              "rounded-full border px-3.5 py-1.5 text-sm font-semibold transition",
              d === doc ? "border-accent/60 bg-accent/10 text-accent" : "border-line text-muted hover:text-fg",
            )}
          >
            {t(LEGAL_LABEL[d])}
          </Link>
        ))}
      </nav>
      {data ? (
        <article>
          <Heading>{data.title}</Heading>
          <p className="mt-2 text-sm text-muted">{t("legal.revision", { v: data.version, date: formatDateTime(data.updated_at, undefined, locale) })}</p>
          <Markdown source={data.body_markdown} className="mt-6 text-fg/90" />
        </article>
      ) : fallback.error ? (
        <div className="space-y-3">
          <Alert>{fallback.error}</Alert>
          <Button variant="secondary" onClick={fallback.reload}>
            {t("legal.retry")}
          </Button>
        </div>
      ) : (
        <div className="flex justify-center py-16">
          <Spinner className="h-8 w-8" />
        </div>
      )}
    </main>
  );
}
