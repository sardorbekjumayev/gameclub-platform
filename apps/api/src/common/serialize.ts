import { Prisma } from '@prisma/client';

/**
 * API javobi uchun chuqur konvertatsiya: BigInt (tiyin) → number, Decimal (rating) → number.
 * Tiyin summalari Number.MAX_SAFE_INTEGER (~90 trln so'm) dan oshmaydi.
 */
export function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = serialize(v);
    return out;
  }
  return value;
}
