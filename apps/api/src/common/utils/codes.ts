import { createHmac, randomInt } from 'crypto';
import { safeEqual } from './crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Bron kodi: GC- + 6 belgi Crockford base32 (docs/01-API.md §6.9). */
export const bookingCode = () => 'GC-' + Array.from({ length: 6 }, () => CROCKFORD[randomInt(0, 32)]).join('');

/** QR payload: gc1.<bookingId>.<exp>.<hmac> — taxmin qilib bo'lmaydi. */
export function signQr(bookingId: string, exp: Date, secret: string): string {
  const e = Math.floor(exp.getTime() / 1000);
  const mac = createHmac('sha256', secret).update(`gc1.${bookingId}.${e}`).digest('base64url').slice(0, 32);
  return `gc1.${bookingId}.${e}.${mac}`;
}

export function verifyQr(payload: string, secret: string, now = new Date()): { booking_id: string } | null {
  const [v, id, e, mac] = payload.split('.');
  if (v !== 'gc1' || !id || !e || !mac) return null;
  const expected = createHmac('sha256', secret).update(`gc1.${id}.${e}`).digest('base64url').slice(0, 32);
  if (!safeEqual(mac, expected)) return null;
  if (Number(e) * 1000 < now.getTime()) return null;
  return { booking_id: id };
}

export function slugify(s: string): string {
  const map: Record<string, string> = { "'": '', 'ʻ': '', 'ʼ': '', '`': '', 'ё': 'yo', 'ж': 'zh', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ю': 'yu', 'я': 'ya', 'ц': 'ts', 'х': 'x', 'ғ': 'g', 'қ': 'q', 'ў': 'o', 'ҳ': 'h' };
  const cyr = 'абвгдезийклмнопрстуфыэ';
  const lat = 'abvgdeziyklmnoprstufie';
  return s
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? (cyr.includes(c) ? lat[cyr.indexOf(c)] : c))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'club';
}

/** Operator uchun telefon maskasi: +998 90 *** ** 12 */
export const maskPhone = (p?: string | null) => (p && p.length >= 12 ? `${p.slice(0, 4)} ${p.slice(4, 6)} *** ** ${p.slice(-2)}` : p ?? null);

/** Arenda kodi: RN- + 6 belgi Crockford base32. */
export const rentalCode = () => 'RN-' + Array.from({ length: 6 }, () => CROCKFORD[randomInt(0, 32)]).join('');
