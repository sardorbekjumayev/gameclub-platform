/** Huquqiy hujjatlar (`GET /legal/:doc?lang=`). Matnlarni API beradi — super admin platforma panelida tahrirlaydi. */
export const LEGAL_DOCS = ["offer", "privacy", "terms", "partner"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
export type LegalLang = "uz" | "ru" | "en";

export type LegalDocData = { doc: LegalDoc; lang: LegalLang; title: string; body_markdown: string; version: number; updated_at: string };

export const isLegalDoc = (v: string): v is LegalDoc => (LEGAL_DOCS as readonly string[]).includes(v);

/** Footer va rozilik qatorlari uchun i18n kalitlari. */
export const LEGAL_LABEL = {
  offer: "legal.offer",
  privacy: "legal.privacy",
  terms: "legal.terms",
  partner: "legal.partner",
} as const;
