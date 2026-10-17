import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../clubs/clubs.service';
import { SettingsService } from '../settings/settings.service';
import { LEGAL_DEFAULTS, LEGAL_DEFAULTS_DATE, LEGAL_DOCS, LEGAL_LANGS, type LegalDoc, type LegalLang } from './defaults';
import { LEGAL_BODY_MAX, LEGAL_TITLE_MAX, type UpdateLegalDto } from './legal.dto';

/** Rozilik talab qiladigan hujjatlar (mijozga ko'rsatiladigan). `partner` — klublar uchun, bu yerda emas. */
export const CONSENT_DOCS: readonly LegalDoc[] = ['offer', 'privacy', 'terms'];

/** `platform_settings` dagi qiymat: `legal.<doc>` → barcha tillar + versiya. Tahrirlanmagan til — kod qoralamasi. */
export type StoredLegal = {
  version: number;
  updated_at: string;
  texts: Partial<Record<LegalLang, { title: string; body_markdown: string }>>;
};

export const legalKey = (doc: LegalDoc) => `legal.${doc}`;

/** Qo'llab-quvvatlanmagan yoki bo'sh til — `uz`. */
export function legalLang(raw?: string): LegalLang {
  const l = raw?.trim().toLowerCase() ?? '';
  return (LEGAL_LANGS as readonly string[]).includes(l) ? (l as LegalLang) : 'uz';
}

/** Saqlangan matn, yo'q bo'lsa — shu tildagi kod qoralamasi. */
export function legalText(doc: LegalDoc, stored: StoredLegal | undefined, lang: LegalLang) {
  const own = stored?.texts?.[lang];
  if (own) return { title: own.title, body_markdown: own.body_markdown, is_default: false };
  const d = LEGAL_DEFAULTS[doc][lang];
  return { title: d.title, body_markdown: d.body, is_default: true };
}

@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Noma'lum hujjat — 404 (ommaviy URL, enum validatsiya o'rniga). */
  private assertDoc(doc: string): LegalDoc {
    if (!(LEGAL_DOCS as readonly string[]).includes(doc)) throw new AppException('NOT_FOUND', 'Legal document not found');
    return doc as LegalDoc;
  }

  private stored(doc: LegalDoc) {
    return this.settings.get<StoredLegal | undefined>(legalKey(doc));
  }

  async publicDoc(rawDoc: string, rawLang?: string) {
    const doc = this.assertDoc(rawDoc);
    const lang = legalLang(rawLang);
    const s = await this.stored(doc);
    const { title, body_markdown } = legalText(doc, s, lang);
    return { doc, lang, title, body_markdown, version: s?.version ?? 1, updated_at: s?.updated_at ?? LEGAL_DEFAULTS_DATE };
  }

  async adminDoc(rawDoc: string) {
    const doc = this.assertDoc(rawDoc);
    return this.adminView(doc, await this.stored(doc));
  }

  private adminView(doc: LegalDoc, s: StoredLegal | undefined) {
    return {
      doc,
      version: s?.version ?? 1,
      updated_at: s?.updated_at ?? LEGAL_DEFAULTS_DATE,
      texts: Object.fromEntries(LEGAL_LANGS.map((l) => [l, legalText(doc, s, l)])) as Record<LegalLang, ReturnType<typeof legalText>>,
      limits: { title_max: LEGAL_TITLE_MAX, body_max: LEGAL_BODY_MAX },
    };
  }

  /** Bitta til matnini saqlaydi: versiya +1, audit (eski/yangi matn bilan) — bitta tranzaksiyada. */
  async update(rawDoc: string, dto: UpdateLegalDto, actor: Actor) {
    const doc = this.assertDoc(rawDoc);
    const key = legalKey(doc);
    const next = await this.prisma.$transaction(async (tx) => {
      // Parallel saqlashda ikki tahrir bir xil versiya olmasin
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const row = await tx.platform_settings.findUnique({ where: { key } });
      const cur = (row?.value ?? undefined) as StoredLegal | undefined;
      const version = cur?.version ?? 1;
      if (dto.expected_version !== undefined && dto.expected_version !== version) {
        throw new AppException('CONFLICT', 'Document was changed by someone else', { reason: 'VERSION_MISMATCH', version });
      }
      const before = legalText(doc, cur, dto.lang);
      const text = { title: dto.title.trim(), body_markdown: dto.body_markdown };
      const value: StoredLegal = { version: version + 1, updated_at: new Date().toISOString(), texts: { ...cur?.texts, [dto.lang]: text } };
      await this.settings.set(key, value, actor.id, tx);
      await this.audit.log(
        {
          actor_id: actor.id,
          action: 'admin.legal.update',
          target_type: 'platform_setting',
          target_id: key,
          old_value: { version, lang: dto.lang, ...before },
          new_value: { version: value.version, lang: dto.lang, ...text },
          ip: actor.ip,
          user_agent: actor.ua,
          request_id: actor.request_id,
        },
        tx,
      );
      return value;
    });
    // Commit'dan keyin: tranzaksiya davomida boshqa so'rov eski qiymatni keshlagan bo'lishi mumkin
    this.settings.invalidate();
    return this.adminView(doc, next);
  }

  // ---------- Rozilik (consents) ----------

  private assertConsentDoc(rawDoc: string): LegalDoc {
    const doc = this.assertDoc(rawDoc);
    if (!CONSENT_DOCS.includes(doc)) {
      throw new AppException('VALIDATION_ERROR', 'This document does not require consent', { field: 'doc', reason: 'NOT_CONSENTABLE' });
    }
    return doc;
  }

  // DB `consents.document_type` — enum (UPPERCASE), API `doc` — slug (lowercase).
  private consentView(row: { document_type: string; version: string; accepted_at: Date }) {
    return { doc: row.document_type.toLowerCase(), version: row.version, accepted_at: row.accepted_at };
  }

  /** Foydalanuvchi hujjatning joriy versiyasiga rozilik beradi. Bir versiyaga takroriy chaqiruv idempotent. */
  async recordConsent(userId: string, rawDoc: string, ip?: string | null) {
    const doc = this.assertConsentDoc(rawDoc);
    const type = doc.toUpperCase();
    const s = await this.stored(doc);
    const version = String(s?.version ?? 1);
    const existing = await this.prisma.consents.findFirst({ where: { user_id: userId, document_type: type, version } });
    if (existing) return this.consentView(existing);
    const row = await this.prisma.consents.create({
      data: { id: uuidv7(), user_id: userId, document_type: type, version, accepted_at: new Date(), ip: ip ?? null },
    });
    return this.consentView(row);
  }

  /** Foydalanuvchining har bir hujjat bo'yicha eng oxirgi roziligi. */
  async myConsents(userId: string) {
    const rows = await this.prisma.consents.findMany({ where: { user_id: userId }, orderBy: { accepted_at: 'desc' } });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.document_type)) latest.set(r.document_type, r);
    return CONSENT_DOCS.map((doc) => {
      const r = latest.get(doc.toUpperCase());
      return { doc, version: r?.version ?? null, accepted_at: r?.accepted_at ?? null };
    });
  }
}
