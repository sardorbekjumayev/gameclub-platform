import { isWithinHours, openIntervals, openState, validateWorkingHours, WorkingHours } from './working-hours';
import { openBillableMinutes } from './open-session';
import {
  DEFAULT_CANCELLATION_POLICY, maskCard, PackageInput, packageAllowsStart, policyFrom, PriceError, promoDiscount, quote, quotePackage, refundPercent, selectTariff, TariffInput,
} from './price-engine';
import { bestGroup } from './seat-groups';

const TZ = 'Asia/Tashkent'; // UTC+5
const at = (local: string) => new Date(`${local}+05:00`);
const dev = { id: 'd1', type: 'PC', room_id: 'r1', category_id: 'c1' };
const base = (over: Partial<TariffInput> = {}): TariffInput => ({
  id: 't1', name: 'Standard', price_per_hour: 2_000_000n, priority: 0, is_active: true, rules: [], ...over,
});

describe('working hours', () => {
  const wh: WorkingHours = { mon: [{ open: '10:00', close: '02:00' }], tue: [{ open: '10:00', close: '02:00' }] };
  it('night window crosses midnight', () => {
    // 2026-09-28 dushanba
    expect(isWithinHours(wh, [], TZ, at('2026-09-28T23:00:00'), at('2026-09-29T01:00:00'))).toBe(true);
    expect(isWithinHours(wh, [], TZ, at('2026-09-29T01:00:00'), at('2026-09-29T03:00:00'))).toBe(false);
    expect(isWithinHours(wh, [], TZ, at('2026-09-28T09:00:00'), at('2026-09-28T11:00:00'))).toBe(false);
  });
  it('exception closes a day', () => {
    expect(isWithinHours(wh, [{ date: '2026-09-28', is_closed: true }], TZ, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'))).toBe(false);
  });
  it('always_open merges days and open_until', () => {
    const all = { always_open: true };
    expect(isWithinHours(all, [], TZ, at('2026-09-28T23:00:00'), at('2026-09-29T03:00:00'))).toBe(true);
    expect(openState(wh, [], TZ, at('2026-09-28T23:30:00'))).toEqual({ is_open: true, open_until: at('2026-09-29T02:00:00').toISOString() });
    expect(openState(wh, [], TZ, at('2026-09-28T08:00:00')).is_open).toBe(false);
  });
});

describe('price engine', () => {
  it('base price with ceil rounding', () => {
    const r = quote([base({ price_per_hour: 1_000_001n })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T13:30:00'), TZ);
    expect(r.amount).toBe(1_500_002n); // 90*1000001/60 = 1500001.5 -> ceil
  });
  it('night rule crossing midnight splits into segments', () => {
    const t = base({ rules: [{ days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: '22:00', end_time: '08:00', price_per_hour: 1_000_000n, kind: 'NIGHT' }] });
    const r = quote([t], dev, at('2026-09-28T21:00:00'), at('2026-09-28T23:00:00'), TZ);
    expect(r.segments.map((s) => [s.rule, s.minutes])).toEqual([['BASE', 60], ['NIGHT', 60]]);
    expect(r.amount).toBe(3_000_000n);
    // ertasi kuni 01:00 — oldingi kun boshlangan tun oynasi
    expect(quote([t], dev, at('2026-09-29T01:00:00'), at('2026-09-29T02:00:00'), TZ).amount).toBe(1_000_000n);
  });
  it('weekend beats standard, holiday date beats weekday', () => {
    const t = base({
      rules: [
        { days_of_week: [6, 7], start_time: '00:00', end_time: '00:00', price_per_hour: 3_000_000n, kind: 'WEEKEND' },
        { days_of_week: [], start_time: '00:00', end_time: '00:00', price_per_hour: 5_000_000n, kind: 'HOLIDAY', date: new Date('2026-10-01') },
      ],
    });
    expect(quote([t], dev, at('2026-10-03T12:00:00'), at('2026-10-03T13:00:00'), TZ).amount).toBe(3_000_000n); // shanba
    expect(quote([t], dev, at('2026-10-01T12:00:00'), at('2026-10-01T13:00:00'), TZ).amount).toBe(5_000_000n); // bayram
  });
  it('most specific tariff wins, then priority', () => {
    const tariffs = [base(), base({ id: 't2', category_id: 'c1', price_per_hour: 4_000_000n }), base({ id: 't3', device_type: 'PC', price_per_hour: 9n, priority: 10 })];
    expect(quote(tariffs, dev, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'), TZ).tariff_id).toBe('t2');
  });
  it('min minutes enforced; no tariff -> error', () => {
    expect(() => quote([base({ min_minutes: 60 })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T12:30:00'), TZ)).toThrow(PriceError);
    expect(() => quote([base({ device_type: 'PS5' })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'), TZ)).toThrow(PriceError);
  });
  it('promo and refund policy', () => {
    expect(promoDiscount({ type: 'PERCENT', value: 20n, max_discount_amount: 500_000n }, 5_000_000n)).toBe(500_000n);
    expect(promoDiscount({ type: 'FIXED', value: 9_000_000n }, 5_000_000n)).toBe(5_000_000n);
    const start = at('2026-09-28T20:00:00');
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T17:00:00'))).toBe(100);
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T19:00:00'))).toBe(50);
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T19:50:00'))).toBe(0);
  });
});

describe('packages', () => {
  // 1 soat 12 000 so'm, paket 3 soat 30 000 so'm
  const pkg = (over: Partial<PackageInput> = {}): PackageInput => ({
    id: 'p1', tariff_id: 't1', name: '3 soat', duration_minutes: 180, price: 3_000_000n, days_of_week: [], ...over,
  });
  const t = base({ price_per_hour: 1_200_000n, min_minutes: 60, max_minutes: 120 });
  it('fixed price and duration, regular amount for savings; tariff min/max ignored', () => {
    const r = quotePackage([t], dev, at('2026-09-28T12:00:00'), pkg(), TZ);
    expect(r.amount).toBe(3_000_000n);
    expect(r.package).toEqual({ id: 'p1', name: '3 soat', duration_minutes: 180, regular_amount: 3_600_000n });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ rule: 'PACKAGE', package_id: 'p1', minutes: 180, amount: 3_000_000, to: at('2026-09-28T15:00:00').toISOString() });
  });
  it('regular amount follows tariff windows', () => {
    const night = base({ price_per_hour: 1_200_000n, rules: [{ days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: '22:00', end_time: '08:00', price_per_hour: 600_000n, kind: 'NIGHT' }] });
    expect(quotePackage([night], dev, at('2026-09-28T21:00:00'), pkg(), TZ).package!.regular_amount).toBe(1_200_000n + 1_200_000n);
  });
  it('package must belong to the tariff selected for the device', () => {
    const vip = base({ id: 't2', room_id: 'r1', price_per_hour: 2_000_000n });
    expect(() => quotePackage([t, vip], dev, at('2026-09-28T12:00:00'), pkg(), TZ)).toThrow(expect.objectContaining({ code: 'PACKAGE_DEVICE' }));
    expect(quotePackage([t, vip], dev, at('2026-09-28T12:00:00'), pkg({ tariff_id: 't2' }), TZ).amount).toBe(3_000_000n);
    expect(() => quotePackage([base({ device_type: 'PS5' })], dev, at('2026-09-28T12:00:00'), pkg(), TZ)).toThrow(expect.objectContaining({ code: 'NO_TARIFF' }));
  });
  it('night window crossing midnight: start must be inside, end may be outside', () => {
    const n = pkg({ start_time: '22:00', end_time: '08:00', duration_minutes: 480 });
    expect(packageAllowsStart(n, at('2026-09-28T23:00:00'), TZ)).toBe(true);
    expect(packageAllowsStart(n, at('2026-09-29T07:30:00'), TZ)).toBe(true);
    expect(packageAllowsStart(n, at('2026-09-29T08:00:00'), TZ)).toBe(false);
    expect(packageAllowsStart(n, at('2026-09-28T21:59:00'), TZ)).toBe(false);
    expect(() => quotePackage([t], dev, at('2026-09-28T12:00:00'), n, TZ)).toThrow(expect.objectContaining({ code: 'PACKAGE_TIME' }));
  });
  it('days of week: crossing window belongs to the day it started', () => {
    // faqat juma (5) kechasi: 2026-10-02 juma
    const fri = pkg({ days_of_week: [5], start_time: '22:00', end_time: '06:00' });
    expect(packageAllowsStart(fri, at('2026-10-02T23:00:00'), TZ)).toBe(true);
    expect(packageAllowsStart(fri, at('2026-10-03T02:00:00'), TZ)).toBe(true); // shanba tongi — juma oynasi
    expect(packageAllowsStart(fri, at('2026-10-03T23:00:00'), TZ)).toBe(false);
    expect(packageAllowsStart(pkg({ days_of_week: [6, 7] }), at('2026-10-02T12:00:00'), TZ)).toBe(false);
    expect(packageAllowsStart(pkg({ days_of_week: [6, 7] }), at('2026-10-03T12:00:00'), TZ)).toBe(true);
  });
});

describe('openBillableMinutes', () => {
  const min = 60_000;
  it('applies the minimum', () => expect(openBillableMinutes(10 * min, 0, 30, 5)).toBe(30));
  it('counts a started minute and rounds up to the step', () => expect(openBillableMinutes(61 * min + 1, 0, 30, 5)).toBe(65));
  it('per-minute billing when step is 1', () => expect(openBillableMinutes(47 * min, 0, 0, 1)).toBe(47));
  it('subtracts paused time', () => expect(openBillableMinutes(90 * min, 30 * 60, 0, 15)).toBe(60));
  it('never bills zero', () => expect(openBillableMinutes(0, 0, 0, 1)).toBe(1));
});

describe('working hours — edge cases', () => {
  const night: WorkingHours = { mon: [{ open: '10:00', close: '02:00' }], tue: [{ open: '10:00', close: '02:00' }] };
  it('booking may start exactly at open and end exactly at close', () => {
    expect(isWithinHours(night, [], TZ, at('2026-09-28T10:00:00'), at('2026-09-28T11:00:00'))).toBe(true);
    expect(isWithinHours(night, [], TZ, at('2026-09-29T01:00:00'), at('2026-09-29T02:00:00'))).toBe(true);
    expect(isWithinHours(night, [], TZ, at('2026-09-29T01:30:00'), at('2026-09-29T02:01:00'))).toBe(false);
  });
  it('a booking cannot bridge two separate windows (closed 02:00–10:00 in between)', () => {
    expect(isWithinHours(night, [], TZ, at('2026-09-29T01:00:00'), at('2026-09-29T11:00:00'))).toBe(false);
    expect(openIntervals(night, [], TZ, at('2026-09-29T00:00:00'), at('2026-09-29T12:00:00'))).toEqual([
      [at('2026-09-28T10:00:00').getTime(), at('2026-09-29T02:00:00').getTime()],
      [at('2026-09-29T10:00:00').getTime(), at('2026-09-30T02:00:00').getTime()],
    ]);
  });
  it('day without key or with an empty array is closed', () => {
    // 2026-09-30 chorshanba — kalit yo'q; 2026-10-04 yakshanba — bo'sh massiv
    expect(isWithinHours(night, [], TZ, at('2026-09-30T12:00:00'), at('2026-09-30T13:00:00'))).toBe(false);
    expect(isWithinHours({ ...night, sun: [] }, [], TZ, at('2026-10-04T12:00:00'), at('2026-10-04T13:00:00'))).toBe(false);
    // dushanba oynasi seshanba 02:00 gacha davom etadi, chorshanba oynasi yo'q — seshanba oynasi chorshanba 02:00 gacha
    expect(isWithinHours(night, [], TZ, at('2026-09-30T01:00:00'), at('2026-09-30T02:00:00'))).toBe(true);
  });
  it('open == close means a full 24h window; several windows per day', () => {
    expect(isWithinHours({ mon: [{ open: '08:00', close: '08:00' }] }, [], TZ, at('2026-09-28T09:00:00'), at('2026-09-29T07:00:00'))).toBe(true);
    const split: WorkingHours = { mon: [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '20:00' }] };
    expect(isWithinHours(split, [], TZ, at('2026-09-28T10:00:00'), at('2026-09-28T12:00:00'))).toBe(true);
    expect(isWithinHours(split, [], TZ, at('2026-09-28T11:00:00'), at('2026-09-28T15:00:00'))).toBe(false);
    expect(isWithinHours(split, [], TZ, at('2026-09-28T14:00:00'), at('2026-09-28T20:00:00'))).toBe(true);
  });
  it('always_open: any range within days, even multi-day; exception closes a single day', () => {
    const all: WorkingHours = { always_open: true };
    expect(isWithinHours(all, [], TZ, at('2026-09-28T00:00:00'), at('2026-09-29T00:00:00'))).toBe(true);
    expect(isWithinHours(all, [], TZ, at('2026-09-28T22:00:00'), at('2026-09-30T02:00:00'))).toBe(true);
    const ex = [{ date: '2026-09-29', is_closed: true }];
    expect(isWithinHours(all, ex, TZ, at('2026-09-29T12:00:00'), at('2026-09-29T13:00:00'))).toBe(false);
    expect(isWithinHours(all, ex, TZ, at('2026-09-28T22:00:00'), at('2026-09-29T00:00:00'))).toBe(true);
    expect(isWithinHours(all, ex, TZ, at('2026-09-28T23:00:00'), at('2026-09-29T00:30:00'))).toBe(false);
    expect(isWithinHours(all, ex, TZ, at('2026-09-30T00:00:00'), at('2026-09-30T01:00:00'))).toBe(true);
    expect(openState(all, [], TZ, at('2026-09-28T03:00:00')).is_open).toBe(true);
  });
  it('exception with special hours replaces the regular day (incl. overnight special hours)', () => {
    const ex = [{ date: '2026-09-28', is_closed: false, open_time: '12:00', close_time: '18:00' }];
    expect(isWithinHours(night, ex, TZ, at('2026-09-28T12:00:00'), at('2026-09-28T18:00:00'))).toBe(true);
    expect(isWithinHours(night, ex, TZ, at('2026-09-28T10:00:00'), at('2026-09-28T11:00:00'))).toBe(false);
    expect(isWithinHours(night, ex, TZ, at('2026-09-28T19:00:00'), at('2026-09-28T20:00:00'))).toBe(false);
    // Yangi yil kechasi: 20:00 dan ertalab 06:00 gacha
    const nye = [{ date: new Date('2026-09-28'), is_closed: false, open_time: '20:00', close_time: '06:00' }];
    expect(isWithinHours(night, nye, TZ, at('2026-09-29T03:00:00'), at('2026-09-29T06:00:00'))).toBe(true);
    expect(isWithinHours(night, nye, TZ, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'))).toBe(false);
  });
  it('closed exception for the next day does not cut the previous overnight window', () => {
    const ex = [{ date: '2026-09-29', is_closed: true }];
    expect(isWithinHours(night, ex, TZ, at('2026-09-29T00:30:00'), at('2026-09-29T01:30:00'))).toBe(true);
    expect(isWithinHours(night, ex, TZ, at('2026-09-29T12:00:00'), at('2026-09-29T13:00:00'))).toBe(false);
  });
  it('openState is closed outside windows and reports the window end inside', () => {
    expect(openState(night, [], TZ, at('2026-09-29T05:00:00'))).toEqual({ is_open: false, open_until: null });
    expect(openState(night, [], TZ, at('2026-09-29T01:59:00')).open_until).toBe(at('2026-09-29T02:00:00').toISOString());
  });
  it('validateWorkingHours', () => {
    expect(validateWorkingHours({ always_open: true })).toBe(true);
    expect(validateWorkingHours({ mon: [{ open: '10:00', close: '02:00' }], sun: [] })).toBe(true);
    expect(validateWorkingHours({ mon: [{ open: '24:00', close: '02:00' }] })).toBe(false);
    expect(validateWorkingHours({ mon: [{ open: '9:00', close: '18:00' }] })).toBe(false);
    expect(validateWorkingHours({ mon: { open: '09:00', close: '18:00' } })).toBe(false);
    expect(validateWorkingHours(null)).toBe(false);
    expect(validateWorkingHours('always')).toBe(false);
  });
});

describe('price engine — edge cases', () => {
  const H = (h: number) => `${String(h).padStart(2, '0')}:00`;
  it('every segment is ceil-rounded separately', () => {
    // 20:30–22:30: BASE 90 daq + NIGHT 30 daq, ikkalasi ham kasr tiyin
    const t = base({ price_per_hour: 1_000_001n, rules: [{ days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: H(22), end_time: H(8), price_per_hour: 333_333n, kind: 'NIGHT' }] });
    const r = quote([t], dev, at('2026-09-28T20:30:00'), at('2026-09-28T22:30:00'), TZ);
    expect(r.segments.map((s) => [s.rule, s.minutes, s.amount])).toEqual([['BASE', 90, 1_500_002], ['NIGHT', 30, 166_667]]);
    expect(r.amount).toBe(1_500_002n + 166_667n);
    expect(r.segments[0]).toMatchObject({ from: at('2026-09-28T20:30:00').toISOString(), to: at('2026-09-28T22:00:00').toISOString(), price_per_hour: 1_000_001, tariff_id: 't1' });
  });
  it('a single minute is charged at least one tiyin; zero price is free', () => {
    expect(quote([base({ price_per_hour: 1n })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T12:01:00'), TZ).amount).toBe(1n);
    expect(quote([base({ price_per_hour: 0n })], dev, at('2026-09-28T12:00:00'), at('2026-09-28T14:00:00'), TZ).amount).toBe(0n);
  });
  it('night window spanning the whole booking and back to day: BASE → NIGHT → BASE', () => {
    const t = base({ rules: [{ days_of_week: [1, 2, 3, 4, 5, 6, 7], start_time: H(22), end_time: H(8), price_per_hour: 1_000_000n, kind: 'NIGHT' }] });
    const r = quote([t], dev, at('2026-09-28T21:00:00'), at('2026-09-29T09:00:00'), TZ);
    expect(r.segments.map((s) => [s.rule, s.minutes])).toEqual([['BASE', 60], ['NIGHT', 600], ['BASE', 60]]);
    expect(r.amount).toBe(2_000_000n + 10_000_000n + 2_000_000n);
  });
  it('night window only on selected weekdays belongs to the day it started', () => {
    // faqat juma (5) tuni arzon; shanba 01:00 — juma tuni (arzon), yakshanba 01:00 — shanba tuni (oddiy)
    const t = base({ rules: [{ days_of_week: [5], start_time: H(22), end_time: H(6), price_per_hour: 500_000n, kind: 'NIGHT' }] });
    expect(quote([t], dev, at('2026-10-03T01:00:00'), at('2026-10-03T02:00:00'), TZ).amount).toBe(500_000n);
    expect(quote([t], dev, at('2026-10-04T01:00:00'), at('2026-10-04T02:00:00'), TZ).amount).toBe(2_000_000n);
  });
  it('weekend boundary: Friday 23:00 → Saturday 01:00 splits at midnight', () => {
    const t = base({ rules: [{ days_of_week: [6, 7], start_time: H(0), end_time: H(0), price_per_hour: 3_000_000n, kind: 'WEEKEND' }] });
    const r = quote([t], dev, at('2026-10-02T23:00:00'), at('2026-10-03T01:00:00'), TZ);
    expect(r.segments.map((s) => [s.rule, s.minutes, s.amount])).toEqual([['BASE', 60, 2_000_000], ['WEEKEND', 60, 3_000_000]]);
    // Yakshanba → dushanba: dushanba 00:00 dan oddiy narx
    const r2 = quote([t], dev, at('2026-10-04T23:30:00'), at('2026-10-05T00:30:00'), TZ);
    expect(r2.segments.map((s) => [s.rule, s.minutes])).toEqual([['WEEKEND', 30], ['BASE', 30]]);
  });
  it('rule kind precedence when windows overlap: HOLIDAY > WEEKEND > NIGHT > STANDARD', () => {
    const all = [1, 2, 3, 4, 5, 6, 7];
    const t = base({
      rules: [
        { days_of_week: all, start_time: H(10), end_time: H(23), price_per_hour: 1_500_000n, kind: 'STANDARD' },
        { days_of_week: all, start_time: H(22), end_time: H(8), price_per_hour: 1_000_000n, kind: 'NIGHT' },
        { days_of_week: [6, 7], start_time: H(0), end_time: H(0), price_per_hour: 3_000_000n, kind: 'WEEKEND' },
        { days_of_week: [], start_time: H(0), end_time: H(0), price_per_hour: 5_000_000n, kind: 'HOLIDAY', date: new Date('2026-10-01') },
      ],
    });
    const rule = (local: string) => quote([t], dev, at(local), new Date(at(local).getTime() + 60_000), TZ).segments[0].rule;
    expect(rule('2026-09-28T09:00:00')).toBe('BASE'); // hech qaysi oyna (night 08:00 da tugaydi)
    expect(rule('2026-09-28T12:00:00')).toBe('STANDARD');
    expect(rule('2026-09-28T22:30:00')).toBe('NIGHT'); // STANDARD bilan kesishadi
    expect(rule('2026-10-03T22:30:00')).toBe('WEEKEND'); // shanba
    expect(rule('2026-10-01T22:30:00')).toBe('HOLIDAY');
  });
  it('holiday date window continues past midnight into the next day', () => {
    const t = base({ rules: [{ days_of_week: [], start_time: H(20), end_time: H(4), price_per_hour: 9_000_000n, kind: 'HOLIDAY', date: new Date('2026-12-31') }] });
    expect(quote([t], dev, at('2027-01-01T02:00:00'), at('2027-01-01T03:00:00'), TZ).amount).toBe(9_000_000n);
    expect(quote([t], dev, at('2027-01-01T20:00:00'), at('2027-01-01T21:00:00'), TZ).amount).toBe(2_000_000n);
  });
  it('max minutes enforced with ABOVE_MAX; bounds are inclusive', () => {
    const t = base({ min_minutes: 60, max_minutes: 120 });
    const err = (() => { try { quote([t], dev, at('2026-09-28T12:00:00'), at('2026-09-28T14:30:00'), TZ); } catch (e) { return e as PriceError; } })();
    expect(err).toBeInstanceOf(PriceError);
    expect(err).toMatchObject({ code: 'ABOVE_MAX', details: { max_minutes: 120 } });
    expect(quote([t], dev, at('2026-09-28T12:00:00'), at('2026-09-28T13:00:00'), TZ).amount).toBe(2_000_000n);
    expect(quote([t], dev, at('2026-09-28T12:00:00'), at('2026-09-28T14:00:00'), TZ).amount).toBe(4_000_000n);
    expect(() => quote([t], dev, at('2026-09-28T12:00:00'), at('2026-09-28T12:59:00'), TZ)).toThrow(expect.objectContaining({ code: 'BELOW_MIN' }));
  });
  it('tariff specificity: device > room > category > device_type > branch default', () => {
    const at12 = at('2026-09-28T12:00:00');
    const all = [
      base({ id: 'default' }),
      base({ id: 'type', device_type: 'PC' }),
      base({ id: 'cat', category_id: 'c1' }),
      base({ id: 'room', room_id: 'r1' }),
      base({ id: 'dev', device_id: 'd1' }),
    ];
    expect(selectTariff(all, dev, at12, TZ)!.id).toBe('dev');
    expect(selectTariff(all.slice(0, 4), dev, at12, TZ)!.id).toBe('room');
    expect(selectTariff(all.slice(0, 3), dev, at12, TZ)!.id).toBe('cat');
    expect(selectTariff(all.slice(0, 2), dev, at12, TZ)!.id).toBe('type');
    expect(selectTariff(all.slice(0, 1), dev, at12, TZ)!.id).toBe('default');
    // Boshqa qurilma/xona/kategoriya uchun tariflar mos kelmaydi
    const other = [base({ id: 'x', device_id: 'd2' }), base({ id: 'y', room_id: 'r2' }), base({ id: 'z', category_id: 'c2' }), base({ id: 'w', device_type: 'PS5' })];
    expect(selectTariff(other, dev, at12, TZ)).toBeNull();
  });
  it('priority breaks ties within the same specificity; inactive tariffs are ignored', () => {
    const at12 = at('2026-09-28T12:00:00');
    expect(selectTariff([base({ id: 'a', priority: 1 }), base({ id: 'b', priority: 5 })], dev, at12, TZ)!.id).toBe('b');
    expect(selectTariff([base({ id: 'a' }), base({ id: 'b', device_id: 'd1', is_active: false })], dev, at12, TZ)!.id).toBe('a');
    expect(() => quote([base({ is_active: false })], dev, at12, at('2026-09-28T13:00:00'), TZ)).toThrow(expect.objectContaining({ code: 'NO_TARIFF', details: { device_id: 'd1' } }));
  });
  it('valid_from / valid_to are inclusive branch-local dates', () => {
    const t = base({ id: 'promo', priority: 10, price_per_hour: 1n, valid_from: new Date('2026-10-01'), valid_to: new Date('2026-10-03') });
    const tariffs = [base(), t];
    const pick = (local: string) => selectTariff(tariffs, dev, at(local), TZ)!.id;
    expect(pick('2026-09-30T23:59:00')).toBe('t1');
    expect(pick('2026-10-01T00:00:00')).toBe('promo'); // Toshkent bo'yicha 1-oktabr (UTC da hali 30-sentabr)
    expect(pick('2026-10-03T23:59:00')).toBe('promo');
    expect(pick('2026-10-04T00:00:00')).toBe('t1');
  });
  it('tariff is chosen by start time and applies to the whole booking', () => {
    const t = base({ id: 'old', priority: 10, price_per_hour: 1_000_000n, valid_to: new Date('2026-10-01') });
    const r = quote([base(), t], dev, at('2026-10-01T23:00:00'), at('2026-10-02T01:00:00'), TZ);
    expect(r.tariff_id).toBe('old');
    expect(r.amount).toBe(2_000_000n);
  });
});

describe('promo, refund and policy helpers', () => {
  it('percent discount floors to whole tiyin and respects the cap', () => {
    expect(promoDiscount({ type: 'PERCENT', value: 15n }, 333n)).toBe(49n); // 49.95 → 49
    expect(promoDiscount({ type: 'PERCENT', value: 100n }, 5_000_000n)).toBe(5_000_000n);
    expect(promoDiscount({ type: 'PERCENT', value: 50n, max_discount_amount: null }, 1_000n)).toBe(500n);
    expect(promoDiscount({ type: 'FIXED', value: 300n, max_discount_amount: 200n }, 1_000n)).toBe(200n);
    expect(promoDiscount({ type: 'FIXED', value: 300n }, 0n)).toBe(0n);
    expect(promoDiscount({ type: 'FIXED', value: -5n }, 1_000n)).toBe(0n);
  });
  it('refund percent: boundaries inclusive, after start nothing, unsorted rules', () => {
    const start = at('2026-09-28T20:00:00');
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T18:00:00'))).toBe(100); // aniq 120 daq
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T18:00:01'))).toBe(50);
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T19:30:00'))).toBe(50); // aniq 30 daq
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T20:00:00'))).toBe(0);
    expect(refundPercent(DEFAULT_CANCELLATION_POLICY, start, at('2026-09-28T21:00:00'))).toBe(0);
    const custom = { rules: [{ min_minutes_before_start: 0, refund_percent: 10 }, { min_minutes_before_start: 1440, refund_percent: 100 }, { min_minutes_before_start: 60, refund_percent: 70 }] };
    expect(refundPercent(custom, start, at('2026-09-27T19:00:00'))).toBe(100);
    expect(refundPercent(custom, start, at('2026-09-28T12:00:00'))).toBe(70);
    expect(refundPercent(custom, start, at('2026-09-28T19:59:00'))).toBe(10);
    expect(refundPercent({ rules: [] }, start, at('2026-09-20T00:00:00'))).toBe(0);
  });
  it('policyFrom fills missing fields from defaults', () => {
    expect(policyFrom(null)).toEqual(DEFAULT_CANCELLATION_POLICY);
    const p = policyFrom({ rules: [{ min_minutes_before_start: 0, refund_percent: 100 }], no_show_refund_percent: 25 });
    expect(p).toMatchObject({ free_cancel_minutes_before: 120, no_show_refund_percent: 25, platform_fee_refundable: false });
    expect(p.rules).toEqual([{ min_minutes_before_start: 0, refund_percent: 100 }]);
  });
  it('maskCard', () => {
    expect(maskCard('8600123412345678')).toBe('8600 •••• •••• 5678');
    expect(maskCard(null)).toBeNull();
    expect(maskCard('')).toBeNull();
  });
  it('package without a time window: any time on allowed days; open == close = all day', () => {
    expect(packageAllowsStart({ days_of_week: [], start_time: null, end_time: null }, at('2026-09-28T03:00:00'), TZ)).toBe(true);
    expect(packageAllowsStart({ days_of_week: [1], start_time: '00:00', end_time: '00:00' }, at('2026-09-28T23:59:00'), TZ)).toBe(true);
    expect(packageAllowsStart({ days_of_week: [2], start_time: '00:00', end_time: '00:00' }, at('2026-09-28T23:59:00'), TZ)).toBe(false);
    // faqat start_time berilgan — oyna yo'q deb hisoblanadi
    expect(packageAllowsStart({ days_of_week: [], start_time: '10:00', end_time: null }, at('2026-09-28T03:00:00'), TZ)).toBe(true);
  });
  it('package price is per device and independent of tariff rules', () => {
    const t = base({ price_per_hour: 1_200_000n, rules: [{ days_of_week: [6, 7], start_time: '00:00', end_time: '00:00', price_per_hour: 2_400_000n, kind: 'WEEKEND' }] });
    const p: PackageInput = { id: 'p', tariff_id: 't1', name: '2 soat', duration_minutes: 120, price: 2_000_000n, days_of_week: [] };
    const r = quotePackage([t], dev, at('2026-10-03T12:00:00'), p, TZ);
    expect(r.amount).toBe(2_000_000n);
    expect(r.package!.regular_amount).toBe(4_800_000n);
    // tarif max_minutes paketga ta'sir qilmaydi, oddiy narx ham min/max siz hisoblanadi
    expect(quotePackage([{ ...t, max_minutes: 30, min_minutes: 180 }], dev, at('2026-09-28T12:00:00'), p, TZ).package!.regular_amount).toBe(2_400_000n);
  });
});

describe('seat groups', () => {
  const s = (id: string, x: number, y: number) => ({ id, x, y });
  it('needs at least two seats and enough free seats', () => {
    expect(bestGroup([s('a', 0, 0), s('b', 1, 0)], 1)).toBeNull();
    expect(bestGroup([s('a', 0, 0)], 2)).toBeNull();
  });
  it('prefers consecutive seats in a row (unordered input), first row wins', () => {
    const free = [s('c', 2, 1), s('a', 0, 1), s('b', 1, 1), s('x', 5, 0), s('y', 7, 0)];
    expect(bestGroup(free, 3)).toEqual({ device_ids: ['a', 'b', 'c'], adjacent: true });
    expect(bestGroup([...free, s('z', 6, 0)], 3)).toEqual({ device_ids: ['x', 'z', 'y'], adjacent: true });
    expect(bestGroup(free, 2)).toEqual({ device_ids: ['a', 'b'], adjacent: true });
  });
  it('a gap in the row breaks adjacency; takes the first long-enough run', () => {
    const row = [s('a', 0, 0), s('b', 1, 0), s('c', 3, 0), s('d', 4, 0), s('e', 5, 0)];
    expect(bestGroup(row, 3)).toEqual({ device_ids: ['c', 'd', 'e'], adjacent: true });
  });
  it('falls back to the closest cluster when no run is long enough', () => {
    // ustun bo'ylab yonma-yon (x bir xil) — qatorda emas; uzoqdagi joy tanlanmaydi
    const free = [s('a', 0, 0), s('b', 0, 1), s('c', 0, 2), s('far', 9, 9)];
    const g = bestGroup(free, 3)!;
    expect(g.adjacent).toBe(false);
    expect([...g.device_ids].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('openBillableMinutes — edge cases', () => {
  it('exact step boundary is not rounded further; paused longer than elapsed bills the minimum', () => {
    expect(openBillableMinutes(60 * 60_000, 0, 30, 5)).toBe(60);
    expect(openBillableMinutes(10 * 60_000, 3600, 30, 5)).toBe(30);
    expect(openBillableMinutes(61 * 60_000, 0, 0, 0)).toBe(61); // qadam 0 → 1
  });
});
