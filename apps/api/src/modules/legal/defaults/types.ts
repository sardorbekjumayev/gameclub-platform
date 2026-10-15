export const LEGAL_DOCS = ['offer', 'privacy', 'terms', 'partner'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
export const LEGAL_LANGS = ['uz', 'ru', 'en'] as const;
export type LegalLang = (typeof LEGAL_LANGS)[number];

export type LegalText = { title: string; body: string };
export type LegalTexts = Record<LegalLang, LegalText>;
