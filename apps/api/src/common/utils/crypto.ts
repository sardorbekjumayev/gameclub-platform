import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const randomDigits = (len: number) => Array.from({ length: len }, () => randomInt(0, 10)).join('');

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
