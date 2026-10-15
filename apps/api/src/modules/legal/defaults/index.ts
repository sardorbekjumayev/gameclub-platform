import { OFFER } from './offer';
import { PARTNER } from './partner';
import { PRIVACY } from './privacy';
import { TERMS } from './terms';
import type { LegalDoc, LegalTexts } from './types';

export * from './types';

/** Kodda keladigan qoralama matnlar — super admin tahrirlamaguncha shular qaytariladi. */
export const LEGAL_DEFAULTS: Record<LegalDoc, LegalTexts> = { offer: OFFER, privacy: PRIVACY, terms: TERMS, partner: PARTNER };

/** Qoralamalar e'lon qilingan sana (version 1). */
export const LEGAL_DEFAULTS_DATE = '2026-10-15T00:00:00.000Z';
