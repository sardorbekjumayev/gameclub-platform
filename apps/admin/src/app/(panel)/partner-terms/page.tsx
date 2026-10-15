"use client";

import { formatDateTime } from "@gc/types";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { LoadState } from "@/components/status";
import { Button, Card, Heading } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { useApi } from "@/lib/use-api";

type LegalDoc = { title: string; body_markdown: string; version: number; updated_at: string };

/** Klublar uchun hamkorlik shartlari (ommaviy `GET /legal/partner`) — klub panelidan o'qish uchun. */
export default function PartnerTermsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const doc = useApi<LegalDoc>(`/legal/partner?lang=${locale}`);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        ← {t("legal.back")}
      </Button>
      <LoadState loading={doc.loading && !doc.data} error={doc.error} onRetry={doc.reload} />
      {doc.data && (
        <Card>
          <Heading>{doc.data.title}</Heading>
          <p className="mt-1 text-xs text-muted">{t("legal.version", { v: doc.data.version, date: formatDateTime(doc.data.updated_at, undefined, locale) })}</p>
          <Markdown source={doc.data.body_markdown} className="mt-5" />
        </Card>
      )}
    </div>
  );
}
