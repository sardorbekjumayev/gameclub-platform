import { randomInt } from 'crypto';
import * as argon2 from 'argon2';
import { AppException } from '../../common/errors';

/** Parol siyosati (docs/01-API.md §4.3): min 8, ro'yxatdagi zaif parollar rad. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const WEAK_PASSWORDS = new Set(['12345678', 'password', 'qwerty123', '11111111', 'password1', '123456789', 'iloveyou']);

export function assertStrongPassword(password: string) {
  if (password.length < PASSWORD_MIN || WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new AppException('VALIDATION_ERROR', 'Password is too weak', { field: 'password' });
  }
}

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// Adashtiradigan belgilar yo'q (0/O, 1/l/I) — og'zaki yoki qog'ozda topshirish oson
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const ALL = UPPER + LOWER + DIGITS;

/**
 * Vaqtinchalik parol: `Xxxx-xxxx-xxxx` (12 belgi ≈ 70 bit, CSPRNG), kamida bitta katta, kichik harf va raqam.
 * Faqat bir marta javobda qaytariladi; DB'da faqat argon2 hash.
 */
export function generateTempPassword(): string {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => ALL[randomInt(ALL.length)]);
    const s = chars.join('');
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  }
}

/** Access token'lar (JWT, 15 daq) shu vaqtdan oldin berilgan bo'lsa rad etiladi — parol tiklanganda. */
export const accessCutoffKey = (userId: string) => `auth:access_cutoff:${userId}`;
