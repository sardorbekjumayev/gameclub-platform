/**
 * VIP / ochiq vaqt (operator tugash vaqtisiz ochgan sessiya) uchun to'lanadigan daqiqalar.
 * O'ynalgan vaqt = o'tgan vaqt − pauza; boshlangan daqiqa to'liq hisoblanadi, so'ng `roundMinutes` qadamiga
 * yuqoriga yaxlitlanadi va kamida `minMinutes` olinadi.
 */
export function openBillableMinutes(elapsedMs: number, pausedSeconds: number, minMinutes: number, roundMinutes: number): number {
  const played = Math.max(0, Math.ceil((elapsedMs - pausedSeconds * 1000) / 60_000));
  const step = Math.max(1, roundMinutes);
  const rounded = Math.ceil(played / step) * step;
  return Math.max(rounded, minMinutes, 1);
}
