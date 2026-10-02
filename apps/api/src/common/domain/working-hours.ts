import { DateTime } from 'luxon';

/** docs/02-DATABASE.md §5 working_hours. `close <= open` bo'lsa keyingi kunga o'tadi. */
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type WorkingHours = Partial<Record<DayKey, { open: string; close: string }[]>> & { always_open?: boolean };
export interface HoursException {
  date: Date | string; // YYYY-MM-DD (filial kalendari)
  is_closed: boolean;
  open_time?: string | null;
  close_time?: string | null;
}

export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DEFAULT_WORKING_HOURS: WorkingHours = Object.fromEntries(DAY_KEYS.map((d) => [d, [{ open: '10:00', close: '02:00' }]]));

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (s: unknown): s is string => typeof s === 'string' && TIME_RE.test(s);

export function validateWorkingHours(wh: unknown): wh is WorkingHours {
  if (!wh || typeof wh !== 'object') return false;
  const o = wh as Record<string, unknown>;
  if (o.always_open === true) return true;
  return DAY_KEYS.every((d) => {
    const v = o[d];
    if (v === undefined) return true;
    return Array.isArray(v) && v.every((w) => w && isTime((w as { open: unknown }).open) && isTime((w as { close: unknown }).close));
  });
}

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dateKey = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** [from, to) oraliqlar — kun boshidan boshlab, filial vaqt zonasida qurilgan UTC ms. */
function dayIntervals(wh: WorkingHours, exceptions: Map<string, HoursException>, day: DateTime): [number, number][] {
  const key = day.toISODate()!;
  const ex = exceptions.get(key);
  let windows: { open: string; close: string }[];
  if (ex) {
    if (ex.is_closed || !ex.open_time || !ex.close_time) return [];
    windows = [{ open: ex.open_time, close: ex.close_time }];
  } else if (wh.always_open) {
    return [[day.toMillis(), day.plus({ days: 1 }).toMillis()]];
  } else {
    windows = wh[DAY_KEYS[day.weekday - 1]] ?? [];
  }
  return windows.map((w) => {
    const open = day.plus({ minutes: minutesOf(w.open) });
    let close = day.plus({ minutes: minutesOf(w.close) });
    if (close <= open) close = close.plus({ days: 1 });
    return [open.toMillis(), close.toMillis()] as [number, number];
  });
}

/** Berilgan oraliq atrofidagi barcha ochiq oynalar (qo'shni oynalar birlashtiriladi, masalan always_open kunlari). */
export function openIntervals(wh: WorkingHours, exceptions: HoursException[], tz: string, from: Date, to: Date): [number, number][] {
  const ex = new Map(exceptions.map((e) => [dateKey(e.date), e]));
  let day = DateTime.fromJSDate(from, { zone: tz }).startOf('day').minus({ days: 1 });
  const last = DateTime.fromJSDate(to, { zone: tz }).startOf('day');
  const all: [number, number][] = [];
  while (day <= last) {
    all.push(...dayIntervals(wh, ex, day));
    day = day.plus({ days: 1 });
  }
  all.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const iv of all) {
    const prev = merged[merged.length - 1];
    if (prev && iv[0] <= prev[1]) prev[1] = Math.max(prev[1], iv[1]);
    else merged.push([...iv]);
  }
  return merged;
}

export function isWithinHours(wh: WorkingHours, exceptions: HoursException[], tz: string, start: Date, end: Date): boolean {
  return openIntervals(wh, exceptions, tz, start, end).some(([a, b]) => a <= start.getTime() && end.getTime() <= b);
}

/** Hozir ochiqmi va qachongacha (UI: "02:00 gacha ochiq"). */
export function openState(wh: WorkingHours, exceptions: HoursException[], tz: string, at = new Date()): { is_open: boolean; open_until: string | null } {
  const iv = openIntervals(wh, exceptions, tz, at, at).find(([a, b]) => a <= at.getTime() && at.getTime() < b);
  return { is_open: !!iv, open_until: iv ? new Date(iv[1]).toISOString() : null };
}
