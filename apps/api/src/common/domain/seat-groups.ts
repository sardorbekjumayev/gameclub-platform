/**
 * Do'stlar uchun yonma-yon o'rindiqlar (o'rindiq sxemasi, docs/01-API.md "Xona sxemasi").
 * 1) Bir qatorda ketma-ket turgan bo'sh joylar (x, x+1, ...) — `adjacent: true`.
 * 2) Bo'lmasa — bir-biriga eng yaqin n ta bo'sh joy (Manhattan masofa yig'indisi eng kichik) — `adjacent: false`.
 */
export type SeatPoint = { id: string; x: number; y: number };
export type SeatGroup = { device_ids: string[]; adjacent: boolean };

export function bestGroup(free: SeatPoint[], n: number): SeatGroup | null {
  if (n < 2 || free.length < n) return null;
  const rows = new Map<number, SeatPoint[]>();
  for (const s of free) rows.set(s.y, [...(rows.get(s.y) ?? []), s]);
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(y)!.sort((a, b) => a.x - b.x);
    let start = 0;
    for (let i = 1; i <= row.length; i++) {
      if (i === row.length || row[i].x !== row[i - 1].x + 1) {
        if (i - start >= n) return { device_ids: row.slice(start, start + n).map((s) => s.id), adjacent: true };
        start = i;
      }
    }
  }
  let best: { ids: string[]; cost: number } | null = null;
  for (const anchor of free) {
    const near = [...free].sort((a, b) => dist(anchor, a) - dist(anchor, b)).slice(0, n);
    const cost = near.reduce((sum, s) => sum + near.reduce((acc, o) => acc + dist(s, o), 0), 0);
    if (!best || cost < best.cost) best = { ids: near.map((s) => s.id), cost };
  }
  return best && { device_ids: best.ids, adjacent: false };
}

const dist = (a: SeatPoint, b: SeatPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
