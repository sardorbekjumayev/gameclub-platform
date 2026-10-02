import { DateTime } from 'luxon';

/** docs/01-API.md §6.6 — tarif tanlash va narx hisoblash (pul faqat tiyin, BigInt). */
export interface TariffRuleInput {
  days_of_week: number[]; // 1=Dushanba … 7=Yakshanba (ISO)
  start_time: string;
  end_time: string;
  price_per_hour: bigint;
  kind: string;
  date?: Date | null; // bayram — aniq sana
}
export interface TariffInput {
  id: string;
  name: string;
  device_type?: string | null;
  category_id?: string | null;
  room_id?: string | null;
  device_id?: string | null;
  price_per_hour: bigint;
  min_minutes?: number | null;
  max_minutes?: number | null;
  priority: number;
  is_active: boolean;
  valid_from?: Date | null;
  valid_to?: Date | null;
  rules: TariffRuleInput[];
}
export interface DeviceInput {
  id: string;
  type: string;
  room_id?: string | null;
  category_id?: string | null;
}
export interface PriceSegment {
  from: string;
  to: string;
  tariff_id: string;
  rule: string;
  price_per_hour: number;
  minutes: number;
  amount: number;
}
export interface PriceResult {
  tariff_id: string;
  tariff_name: string;
  amount: bigint;
  segments: PriceSegment[];
}

export class PriceError extends Error {
  constructor(
    readonly code: 'NO_TARIFF' | 'BELOW_MIN' | 'ABOVE_MAX',
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** Aniqlik darajasi: device → room → category → device_type → filial default. */
function specificity(t: TariffInput, d: DeviceInput): number {
  if (t.device_id) return t.device_id === d.id ? 5 : -1;
  if (t.room_id) return t.room_id === d.room_id ? 4 : -1;
  if (t.category_id) return t.category_id === d.category_id ? 3 : -1;
  if (t.device_type) return t.device_type === d.type ? 2 : -1;
  return 1;
}

export function selectTariff(tariffs: TariffInput[], device: DeviceInput, at: Date, tz: string): TariffInput | null {
  const day = DateTime.fromJSDate(at, { zone: tz }).toISODate()!;
  const candidates = tariffs
    .filter((t) => t.is_active)
    .filter((t) => (!t.valid_from || t.valid_from.toISOString().slice(0, 10) <= day) && (!t.valid_to || t.valid_to.toISOString().slice(0, 10) >= day))
    .map((t) => ({ t, s: specificity(t, device) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.t.priority - a.t.priority);
  return candidates[0]?.t ?? null;
}

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const KIND_ORDER: Record<string, number> = { HOLIDAY: 4, WEEKEND: 3, NIGHT: 2, STANDARD: 1 };

/** Daqiqa uchun amal qiluvchi qoida (bayram sanasi > hafta kuni oynasi; kesib o'tuvchi oynalar boshlangan kuniga tegishli). */
function ruleAt(rules: TariffRuleInput[], local: DateTime): TariffRuleInput | null {
  const t = local.hour * 60 + local.minute;
  const today = local.weekday;
  const yesterday = local.minus({ days: 1 });
  const matches = rules.filter((r) => {
    const s = minutesOf(r.start_time);
    const e = minutesOf(r.end_time);
    const dayOk = (d: DateTime) => (r.date ? r.date.toISOString().slice(0, 10) === d.toISODate() : r.days_of_week.includes(d.weekday));
    if (s < e) return t >= s && t < e && dayOk(local);
    if (s === e) return dayOk(local); // butun kun
    return (t >= s && dayOk(local)) || (t < e && dayOk(yesterday));
  });
  void today;
  matches.sort((a, b) => Number(!!b.date) - Number(!!a.date) || (KIND_ORDER[b.kind] ?? 0) - (KIND_ORDER[a.kind] ?? 0));
  return matches[0] ?? null;
}

/**
 * [start, end) narxi. Oraliq qoida chegaralarida segmentlarga bo'linadi;
 * har segment: ceil(minutes × price_per_hour / 60) — butun tiyinga yuqoriga yaxlitlash.
 */
export function quote(tariffs: TariffInput[], device: DeviceInput, start: Date, end: Date, tz: string): PriceResult {
  const tariff = selectTariff(tariffs, device, start, tz);
  if (!tariff) throw new PriceError('NO_TARIFF', { device_id: device.id });
  const total = Math.round((end.getTime() - start.getTime()) / 60000);
  if (tariff.min_minutes && total < tariff.min_minutes) throw new PriceError('BELOW_MIN', { min_minutes: tariff.min_minutes });
  if (tariff.max_minutes && total > tariff.max_minutes) throw new PriceError('ABOVE_MAX', { max_minutes: tariff.max_minutes });

  const segments: PriceSegment[] = [];
  let cursor = DateTime.fromJSDate(start, { zone: tz });
  let current: { rule: string; price: bigint; from: DateTime; minutes: number } | null = null;
  const flush = (to: DateTime) => {
    if (!current) return;
    const amount = (BigInt(current.minutes) * current.price + 59n) / 60n;
    segments.push({
      from: current.from.toUTC().toISO()!,
      to: to.toUTC().toISO()!,
      tariff_id: tariff.id,
      rule: current.rule,
      price_per_hour: Number(current.price),
      minutes: current.minutes,
      amount: Number(amount),
    });
  };
  for (let i = 0; i < total; i++) {
    const r = ruleAt(tariff.rules, cursor);
    const price = r ? r.price_per_hour : tariff.price_per_hour;
    const rule = r ? r.kind : 'BASE';
    if (!current || current.price !== price || current.rule !== rule) {
      flush(cursor);
      current = { rule, price, from: cursor, minutes: 0 };
    }
    current.minutes++;
    cursor = cursor.plus({ minutes: 1 });
  }
  flush(cursor);
  const amount = segments.reduce((s, x) => s + BigInt(x.amount), 0n);
  return { tariff_id: tariff.id, tariff_name: tariff.name, amount, segments };
}

/** Promo chegirmasi (docs/01-API.md §6.12). */
export function promoDiscount(p: { type: string; value: bigint; max_discount_amount?: bigint | null }, subtotal: bigint): bigint {
  let d = p.type === 'PERCENT' ? (subtotal * p.value) / 100n : p.value;
  if (p.max_discount_amount != null && d > p.max_discount_amount) d = p.max_discount_amount;
  if (d > subtotal) d = subtotal;
  return d < 0n ? 0n : d;
}

/** cancellation_policy bo'yicha refund foizi (docs/02-DATABASE.md §5). */
export interface CancellationPolicy {
  rules: { min_minutes_before_start: number; refund_percent: number }[];
  no_show_refund_percent?: number;
}
export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy & { free_cancel_minutes_before: number; platform_fee_refundable: boolean } = {
  free_cancel_minutes_before: 120,
  rules: [
    { min_minutes_before_start: 120, refund_percent: 100 },
    { min_minutes_before_start: 30, refund_percent: 50 },
    { min_minutes_before_start: 0, refund_percent: 0 },
  ],
  platform_fee_refundable: false,
  no_show_refund_percent: 0,
};

export function refundPercent(policy: CancellationPolicy, start: Date, now: Date): number {
  const before = (start.getTime() - now.getTime()) / 60000;
  const rules = [...policy.rules].sort((a, b) => b.min_minutes_before_start - a.min_minutes_before_start);
  return rules.find((r) => before >= r.min_minutes_before_start)?.refund_percent ?? 0;
}
