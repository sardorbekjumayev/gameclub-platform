import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import type { files } from '@prisma/client';
import { AppException } from '../../common/errors';
import { uuidv7 } from '../../common/utils/id';
import { safeEqual } from '../../common/utils/crypto';
import { PrismaService } from '../../database/prisma.service';
import { can } from '../rbac/access';
import type { Grant } from '../rbac/rbac.service';

export const FILE_PURPOSES = ['RECEIPT', 'CLUB_MEDIA', 'CLUB_DOCUMENT'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

/** Ruxsat etilgan turlar — klient yuborgan Content-Type'ga emas, faylning birinchi baytlariga qaraladi. */
const ALLOWED: Record<FilePurpose, string[]> = {
  RECEIPT: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  CLUB_MEDIA: ['image/jpeg', 'image/png', 'image/webp'],
  CLUB_DOCUMENT: ['image/jpeg', 'image/png', 'application/pdf'],
};
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
/** Imzolangan havola muddati (maxfiy fayllar: chek, hujjat). */
const URL_TTL_S = 15 * 60;
/** Bog'lanmagan (yuklangan, lekin to'lovga biriktirilmagan) chek shuncha vaqtdan keyin o'chiriladi. */
const ORPHAN_TTL_MS = 24 * 3600_000;

export interface UploadedBlob {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/**
 * O'z fayl saqlash joyimiz (docs/01-API.md §6.19): fayl `STORAGE_DIR` da, metama'lumot `files` jadvalida.
 * CLUB_MEDIA — ommaviy (logo/muqova); RECEIPT va CLUB_DOCUMENT — faqat egasi va vakolatli xodim, qisqa muddatli imzolangan havola orqali.
 */
@Injectable()
export class FilesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Files');
  private readonly root: string;
  private readonly maxBytes: number;
  private readonly secret: string;
  private readonly publicApi: string;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.root = resolve(config.get<string>('STORAGE_DIR') ?? './storage');
    this.maxBytes = (config.get<number>('UPLOAD_MAX_MB') ?? 10) * 1024 * 1024;
    this.secret = `files:${config.get<string>('QR_HMAC_SECRET')}`;
    this.publicApi = (config.get<string>('PUBLIC_API_URL') ?? 'http://localhost:4700/api/v1').replace(/\/$/, '');
  }

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.purgeOrphans().catch((e) => this.log.warn(`orphan purge failed: ${(e as Error).message}`));
    }, 60 * 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  get maxUploadBytes() {
    return this.maxBytes;
  }

  private pathOf(key: string) {
    const p = resolve(this.root, key);
    // storage_key faqat server yaratadi, baribir ildizdan tashqariga chiqishga yo'l qo'yilmaydi
    if (!p.startsWith(this.root + '/')) throw new AppException('NOT_FOUND', 'File not found');
    return p;
  }

  async upload(ownerId: string, purpose: FilePurpose, blob: UploadedBlob, clubId: string | null) {
    if (!blob?.buffer?.length) throw new AppException('VALIDATION_ERROR', 'File is required', { field: 'file' });
    if (blob.size > this.maxBytes) throw new AppException('VALIDATION_ERROR', 'File is too large', { field: 'file', reason: 'FILE_TOO_LARGE', max_mb: this.maxBytes / 1024 / 1024 });
    const mime = sniffMime(blob.buffer);
    if (!mime || !ALLOWED[purpose].includes(mime)) throw new AppException('VALIDATION_ERROR', 'Unsupported file type', { field: 'file', reason: 'FILE_TYPE', allowed: ALLOWED[purpose] });
    const id = uuidv7();
    const now = new Date();
    const key = join(purpose.toLowerCase(), `${now.getUTCFullYear()}`, String(now.getUTCMonth() + 1).padStart(2, '0'), `${id}.${EXT[mime]}`);
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    // Avval vaqtinchalik faylga — yarim yozilgan fayl hech qachon ko'rinmaydi
    await writeFile(`${path}.part`, blob.buffer, { mode: 0o640 });
    await rename(`${path}.part`, path);
    const name = blob.originalname?.replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 120) || null;
    try {
      return await this.prisma.files.create({
        data: { id, owner_id: ownerId, club_id: clubId, purpose, mime, size: blob.size, sha256: createHash('sha256').update(blob.buffer).digest('hex'), storage_key: key, original_name: name },
      });
    } catch (e) {
      await rm(path, { force: true });
      throw e;
    }
  }

  /** To'lovga biriktiriladigan chek: faqat egasiniki, hali ishlatilmagan RECEIPT. Tranzaksiya ichida chaqiriladi. */
  async claimReceipt(db: Pick<PrismaService, 'files'>, fileId: string, ownerId: string, ref: { type: string; id: string; club_id: string }) {
    const r = await db.files.updateMany({
      where: { id: fileId, owner_id: ownerId, purpose: 'RECEIPT', ref_id: null, deleted_at: null },
      data: { ref_type: ref.type, ref_id: ref.id, club_id: ref.club_id },
    });
    if (!r.count) throw new AppException('VALIDATION_ERROR', 'Receipt file not found or already used', { field: 'receipt_file_id', reason: 'RECEIPT_INVALID' });
  }

  /** Klub hujjati: shu klub uchun yuklangan, hali biriktirilmagan CLUB_DOCUMENT. */
  async claimClubDocument(db: Pick<PrismaService, 'files'>, fileId: string, clubId: string, docId: string) {
    const r = await db.files.updateMany({
      where: { id: fileId, club_id: clubId, purpose: 'CLUB_DOCUMENT', ref_id: null, deleted_at: null },
      data: { ref_type: 'club_document', ref_id: docId },
    });
    if (!r.count) throw new AppException('VALIDATION_ERROR', 'Document file not found or already used', { field: 'file_id', reason: 'FILE_INVALID' });
  }

  /** `club_documents` qatorlariga o'qish havolasi (file_id bo'lsa — vaqtinchalik imzolangan). */
  withDocUrls<T extends { file_id: string | null; file_url: string | null }>(docs: T[]) {
    return docs.map((d) => ({ ...d, file_url: d.file_id ? this.url({ id: d.file_id, purpose: 'CLUB_DOCUMENT' }) : d.file_url }));
  }

  private sign(id: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${id}.${exp}`).digest('base64url');
  }

  /** Brauzer `<img>`/havola orqali ochadi (token yuborib bo'lmaydi) — shuning uchun qisqa muddatli imzo. */
  /** CLUB_MEDIA uchun to'liq manzil (logo_url/cover_url sifatida saqlanadi, mobil ilova ham ochadi). */
  publicUrl(f: Pick<files, 'id'>) {
    return `${this.publicApi}/files/${f.id}/raw`;
  }

  url(f: Pick<files, 'id' | 'purpose'>, now = Date.now()) {
    if (f.purpose === 'CLUB_MEDIA') return `/api/v1/files/${f.id}/raw`;
    const exp = Math.floor(now / 1000) + URL_TTL_S;
    return `/api/v1/files/${f.id}/raw?exp=${exp}&sig=${this.sign(f.id, exp)}`;
  }

  async urlById(id: string | null | undefined) {
    if (!id) return null;
    const f = await this.prisma.files.findFirst({ where: { id, deleted_at: null }, select: { id: true, purpose: true } });
    return f ? this.url(f) : null;
  }

  /** Egasi yoki shu klub/filialdagi vakolatli xodim (platforma xodimi — hammasini). */
  canRead(f: files, userId: string, grants: Grant[], branchId?: string | null) {
    if (f.purpose === 'CLUB_MEDIA' || f.owner_id === userId) return true;
    if (!f.club_id) return false;
    const scope = { club_id: f.club_id, branch_id: branchId ?? null };
    if (f.purpose === 'RECEIPT') return can(grants, 'payments.view', scope) || can(grants, 'payments.create', scope);
    return can(grants, 'clubs.documents.manage', scope) || can(grants, 'platform.clubs.approve', scope);
  }

  async meta(id: string, userId: string, grants: Grant[]) {
    const f = await this.prisma.files.findFirst({ where: { id, deleted_at: null } });
    let branchId: string | null = null;
    if (f?.ref_type === 'payment' && f.ref_id) branchId = (await this.prisma.payments.findUnique({ where: { id: f.ref_id }, select: { branch_id: true } }))?.branch_id ?? null;
    if (!f || !this.canRead(f, userId, grants, branchId)) throw new AppException('NOT_FOUND', 'File not found');
    return { id: f.id, purpose: f.purpose, mime: f.mime, size: f.size, original_name: f.original_name, created_at: f.created_at, url: this.url(f) };
  }

  /** Imzo (yoki ommaviy fayl) tekshirilgach fayl tarkibi. */
  async raw(id: string, exp?: string, sig?: string) {
    const f = await this.prisma.files.findFirst({ where: { id, deleted_at: null } });
    if (!f) throw new AppException('NOT_FOUND', 'File not found');
    if (f.purpose !== 'CLUB_MEDIA') {
      const e = Number(exp);
      if (!sig || !Number.isInteger(e) || e < Date.now() / 1000 || !safeEqual(sig, this.sign(id, e))) throw new AppException('NOT_FOUND', 'File not found');
    }
    return { file: f, body: await readFile(this.pathOf(f.storage_key)) };
  }

  /** Biriktirilmagan cheklar (foydalanuvchi yukladi, lekin yubormadi) — diskda yig'ilib qolmasin. */
  async purgeOrphans(now = new Date()) {
    const stale = await this.prisma.files.findMany({ where: { purpose: 'RECEIPT', ref_id: null, created_at: { lt: new Date(now.getTime() - ORPHAN_TTL_MS) } }, take: 500 });
    for (const f of stale) {
      await rm(this.pathOf(f.storage_key), { force: true });
      await this.prisma.files.delete({ where: { id: f.id } });
    }
    return stale.length;
  }
}
