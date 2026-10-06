import { Prisma, PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { uuidv7 } from '../../src/common/utils/id';

/**
 * Dev demo: konsol arendasi — demo klub filiallariga arenda konsollari va demo mijoz (customer@gameclub.local)
 * uchun har bir holatdagi arendalar. Takroriy ishga tushirilsa mavjudlarini o'tkazib yuboradi (konsol — filial+nom, arenda — kod).
 * Production'da ishlamaydi.
 */
const SUM = (n: number) => BigInt(n * 100); // so'm → tiyin
const TZ = 'Asia/Tashkent';

type ItemSeed = {
  name: string;
  type: 'PS5' | 'PS4' | 'XBOX' | 'NINTENDO_SWITCH' | 'VR' | 'OTHER';
  quantity: number;
  hour?: number;
  day?: number;
  min_hours?: number;
  max_days?: number;
  deposit?: number;
  delivery_fee?: number;
  includes: string[];
  games: string[];
  description: string;
  requirements?: string;
};

const PASSPORT = 'Pasport (yoki ID karta) talab qilinadi. Konsol shikastlansa garov ushlab qolinadi.';

const PS5: ItemSeed = {
  name: 'PlayStation 5 + 2 DualSense', type: 'PS5', quantity: 3, hour: 25_000, day: 180_000, min_hours: 3, max_days: 7, deposit: 1_000_000, delivery_fee: 30_000,
  includes: ['PlayStation 5 (disk versiya)', '2 ta DualSense joystick', 'HDMI 2.1 kabel', 'Zaryad kabeli'],
  games: ['EA FC 25', 'Mortal Kombat 1', 'Spider-Man 2', 'GTA V', 'Tekken 8', 'It Takes Two'],
  description: "Do'stlar bilan uyda futbol yoki file o'ynash uchun. Barcha o'yinlar o'rnatilgan, akkaunt tayyor.",
  requirements: PASSPORT,
};
const PS5_SLIM: ItemSeed = {
  name: 'PlayStation 5 Slim', type: 'PS5', quantity: 2, hour: 22_000, day: 160_000, min_hours: 3, max_days: 5, deposit: 1_000_000, delivery_fee: 25_000,
  includes: ['PlayStation 5 Slim', '2 ta DualSense', 'HDMI kabel'],
  games: ['EA FC 25', 'UFC 5', 'Call of Duty: MW III', 'Gran Turismo 7'],
  description: "Ixcham PS5 Slim — uyga yoki dachaga olib ketish uchun qulay.",
  requirements: PASSPORT,
};
const PS4_PRO: ItemSeed = {
  name: 'PlayStation 4 Pro', type: 'PS4', quantity: 4, hour: 15_000, day: 100_000, min_hours: 2, max_days: 10, deposit: 500_000, delivery_fee: 20_000,
  includes: ['PlayStation 4 Pro 1TB', '2 ta DualShock 4', 'HDMI kabel'],
  games: ['FIFA 23', 'Mortal Kombat 11', 'GTA V', 'The Last of Us Part II', 'UFC 4'],
  description: '4K HDR qo\'llab-quvvatlaydigan PS4 Pro. Tug\'ilgan kun va kechalar uchun ideal.',
  requirements: PASSPORT,
};
const PS4_SLIM: ItemSeed = {
  name: 'PlayStation 4 Slim', type: 'PS4', quantity: 3, day: 80_000, max_days: 14, deposit: 400_000,
  includes: ['PlayStation 4 Slim 500GB', '2 ta DualShock 4', 'HDMI kabel'],
  games: ['FIFA 23', 'Mortal Kombat X', 'Need for Speed Heat', 'Crash Bandicoot'],
  description: 'Faqat kunlik arenda — hafta oxiri uchun arzon variant.',
  requirements: PASSPORT,
};
const XBOX_X: ItemSeed = {
  name: 'Xbox Series X + Game Pass', type: 'XBOX', quantity: 2, day: 160_000, max_days: 7, deposit: 1_000_000,
  includes: ['Xbox Series X 1TB', '2 ta Xbox Wireless Controller', 'Game Pass Ultimate (yuzlab o\'yin)'],
  games: ['Forza Horizon 5', 'Halo Infinite', 'EA FC 25', 'Gears 5'],
  description: "Game Pass bilan yuzlab o'yin — tanlash sizdan.",
  requirements: PASSPORT,
};
const XBOX_ONE: ItemSeed = {
  name: 'Xbox One S', type: 'XBOX', quantity: 1, hour: 12_000, day: 70_000, min_hours: 2, max_days: 7, deposit: 300_000,
  includes: ['Xbox One S 1TB', '2 ta joystick'],
  games: ['FIFA 22', 'Forza Horizon 4', 'Minecraft'],
  description: 'Bolalar va oilaviy o\'yinlar uchun.',
};
const SWITCH: ItemSeed = {
  name: 'Nintendo Switch OLED', type: 'NINTENDO_SWITCH', quantity: 2, hour: 15_000, day: 90_000, min_hours: 2, max_days: 7, deposit: 700_000, delivery_fee: 25_000,
  includes: ['Nintendo Switch OLED', '2 ta Joy-Con', 'Dock + HDMI', "Ko'chma g'ilof"],
  games: ['Mario Kart 8 Deluxe', 'Super Smash Bros. Ultimate', 'Zelda: Tears of the Kingdom', 'Just Dance 2024'],
  description: "Safarga ham olib keting — ekran o'zida bor. Kompaniya bilan Mario Kart!",
  requirements: PASSPORT,
};
const VR: ItemSeed = {
  name: 'PlayStation VR2 + PS5', type: 'VR', quantity: 1, hour: 40_000, day: 300_000, min_hours: 2, max_days: 3, deposit: 2_000_000,
  includes: ['PlayStation 5', 'PS VR2 shlem', '2 ta Sense kontroller', 'DualSense'],
  games: ['Horizon Call of the Mountain', 'Beat Saber', 'Gran Turismo 7 (VR)', 'Resident Evil Village (VR)'],
  description: "Virtual reallik — tug'ilgan kun uchun eng yorqin sovg'a. Birinchi marta bo'lsa, operator qanday ishlatishni ko'rsatadi.",
  requirements: 'Pasport talab qilinadi. Faqat klubdan olib ketiladi (yetkazib berilmaydi).',
};

/** Klub slug → filial nomi → konsollar. */
const CATALOG: Record<string, Record<string, ItemSeed[]>> = {
  'demo-cyber-arena': { Chilonzor: [PS5, PS4_PRO, XBOX_X, VR], Yunusobod: [SWITCH, PS5_SLIM, PS4_SLIM] },
  'demo-pixel-club': { Registon: [{ ...PS5, quantity: 2, hour: 20_000, day: 150_000, delivery_fee: 20_000 }, PS4_SLIM] },
  'demo-level-up': { Markaz: [{ ...PS4_SLIM, quantity: 2, day: 70_000 }, XBOX_ONE] },
};

type RentalSeed = {
  code: string;
  club: string;
  branch: string;
  item: string;
  status: 'REQUESTED' | 'CONFIRMED' | 'ACTIVE' | 'RETURNED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
  unit: 'HOUR' | 'DAY';
  units: number;
  /** Boshlanish: bugundan necha kun (Toshkent) va soat. */
  day: number;
  at: string;
  quantity?: number;
  delivery?: string;
  paid?: 'TERMINAL' | 'CASH' | 'CARD_TRANSFER';
  late_fee?: number;
  deposit?: 'HELD' | 'RETURNED' | 'KEPT';
  reason?: string;
  notes?: string;
  /** ACTIVE uchun: start/end ni "hozir"ga nisbatan surish (soatda) — muddati o'tgan arendani ko'rsatish uchun. */
  shiftHours?: number;
};

const RENTALS: RentalSeed[] = [
  { code: 'RN-DEMO01', club: 'demo-cyber-arena', branch: 'Chilonzor', item: PS5.name, status: 'RETURNED', unit: 'DAY', units: 1, day: -6, at: '14:00', paid: 'TERMINAL', deposit: 'RETURNED', notes: "Tug'ilgan kun uchun" },
  { code: 'RN-DEMO02', club: 'demo-cyber-arena', branch: 'Yunusobod', item: SWITCH.name, status: 'RETURNED', unit: 'HOUR', units: 5, day: -3, at: '16:00', delivery: 'Yunusobod 11-kvartal, 7-uy, 23-xonadon', paid: 'CASH', late_fee: 15_000, deposit: 'RETURNED' },
  { code: 'RN-DEMO03', club: 'demo-cyber-arena', branch: 'Chilonzor', item: PS4_PRO.name, status: 'ACTIVE', unit: 'HOUR', units: 4, day: 0, at: '00:00', shiftHours: -1, paid: 'CARD_TRANSFER', deposit: 'HELD' },
  { code: 'RN-DEMO04', club: 'demo-cyber-arena', branch: 'Chilonzor', item: VR.name, status: 'ACTIVE', unit: 'HOUR', units: 3, day: 0, at: '00:00', shiftHours: -5, paid: 'TERMINAL', deposit: 'HELD', notes: 'Kechikmoqda — operator qo\'ng\'iroq qilsin' },
  { code: 'RN-DEMO05', club: 'demo-cyber-arena', branch: 'Chilonzor', item: XBOX_X.name, status: 'CONFIRMED', unit: 'DAY', units: 2, day: 1, at: '15:00' },
  { code: 'RN-DEMO06', club: 'demo-cyber-arena', branch: 'Yunusobod', item: PS5_SLIM.name, status: 'REQUESTED', unit: 'HOUR', units: 6, day: 1, at: '18:00', quantity: 2, delivery: "Amir Temur ko'chasi 107, 3-podyezd", notes: 'Ikkita kerak — turnir qilamiz' },
  { code: 'RN-DEMO07', club: 'demo-cyber-arena', branch: 'Chilonzor', item: PS5.name, status: 'REQUESTED', unit: 'DAY', units: 3, day: 2, at: '12:00' },
  { code: 'RN-DEMO08', club: 'demo-pixel-club', branch: 'Registon', item: PS4_SLIM.name, status: 'CANCELLED', unit: 'DAY', units: 1, day: -1, at: '13:00', reason: "Rejam o'zgardi" },
  { code: 'RN-DEMO09', club: 'demo-level-up', branch: 'Markaz', item: XBOX_ONE.name, status: 'REJECTED', unit: 'HOUR', units: 3, day: -2, at: '19:00', reason: 'Konsol texnik xizmatda' },
];

export async function seedRentals(prisma: PrismaClient) {
  if (process.env.NODE_ENV === 'production') return;

  // ---------- Konsollar ----------
  const items = new Map<string, Prisma.rental_itemsGetPayload<object>>();
  let created = 0;
  for (const [slug, byBranch] of Object.entries(CATALOG)) {
    for (const [branchName, seeds] of Object.entries(byBranch)) {
      const branch = await prisma.branches.findFirst({ where: { name: branchName, deleted_at: null, club: { slug } } });
      if (!branch) continue;
      for (const [i, s] of seeds.entries()) {
        let it = await prisma.rental_items.findFirst({ where: { branch_id: branch.id, name: s.name, deleted_at: null } });
        if (!it) {
          it = await prisma.rental_items.create({
            data: {
              id: uuidv7(), club_id: branch.club_id, branch_id: branch.id, name: s.name, type: s.type, description: s.description, includes: s.includes, games: s.games,
              quantity: s.quantity, price_per_hour: s.hour ? SUM(s.hour) : null, price_per_day: s.day ? SUM(s.day) : null, min_hours: s.min_hours ?? 1, max_days: s.max_days ?? 30,
              deposit_amount: SUM(s.deposit ?? 0), delivery_available: s.delivery_fee !== undefined, delivery_fee: SUM(s.delivery_fee ?? 0), requirements: s.requirements, position: i,
            },
          });
          created++;
        }
        items.set(`${slug}/${branchName}/${s.name}`, it);
      }
    }
  }
  if (created) console.log(`Demo rental items: ${created}`);

  // ---------- Demo mijoz arendalari ----------
  const customer = await prisma.users.findFirst({ where: { email: 'customer@gameclub.local' } });
  const operator = await prisma.users.findFirst({ where: { email: 'operator@gameclub.local' } });
  if (!customer) return;
  let orders = 0;
  for (const r of RENTALS) {
    if (await prisma.rentals.findUnique({ where: { code: r.code } })) continue;
    const it = items.get(`${r.club}/${r.branch}/${r.item}`);
    if (!it) continue;
    const quantity = r.quantity ?? 1;
    const hours = r.unit === 'HOUR' ? r.units : r.units * 24;
    const start = r.shiftHours !== undefined
      ? DateTime.now().setZone(TZ).plus({ hours: r.shiftHours }).startOf('minute')
      : DateTime.fromISO(`${DateTime.now().setZone(TZ).plus({ days: r.day }).toISODate()}T${r.at}`, { zone: TZ });
    const end = start.plus({ hours });
    const unit = (r.unit === 'HOUR' ? it.price_per_hour : it.price_per_day) ?? 0n;
    const subtotal = unit * BigInt(r.units) * BigInt(quantity);
    const deliveryFee = r.delivery ? it.delivery_fee : 0n;
    const lateFee = SUM(r.late_fee ?? 0);
    const total = subtotal + deliveryFee + lateFee;
    const deposit = it.deposit_amount * BigInt(quantity);
    const handed = ['ACTIVE', 'RETURNED'].includes(r.status);
    const confirmed = handed || r.status === 'CONFIRMED';
    const closedBy = ['CANCELLED', 'REJECTED'].includes(r.status);
    const id = uuidv7();

    await prisma.$transaction(async (tx) => {
      await tx.rentals.create({
        data: {
          id, code: r.code, item_id: it.id, club_id: it.club_id, branch_id: it.branch_id, customer_id: customer.id, contact_phone: customer.phone, quantity,
          rate_unit: r.unit, units: r.units, start_at: start.toJSDate(), end_at: end.toJSDate(), unit_price: unit, subtotal_amount: subtotal,
          delivery_fee_amount: deliveryFee, late_fee_amount: lateFee, total_amount: total, deposit_amount: deposit, deposit_status: handed && deposit > 0n ? (r.deposit ?? 'HELD') : 'NONE',
          paid_amount: r.paid ? total : 0n, payment_status: r.paid ? 'PAID' : 'UNPAID', status: r.status, fulfillment: r.delivery ? 'DELIVERY' : 'PICKUP',
          delivery_address: r.delivery ?? null, notes: r.notes ?? null,
          item_snapshot: {
            name: it.name, type: it.type, image_url: it.image_url, price_per_hour: it.price_per_hour == null ? null : Number(it.price_per_hour),
            price_per_day: it.price_per_day == null ? null : Number(it.price_per_day), deposit_amount: Number(it.deposit_amount),
          },
          confirmed_at: confirmed ? start.minus({ hours: 3 }).toJSDate() : null, confirmed_by: confirmed ? operator?.id : null,
          handed_over_at: handed ? start.toJSDate() : null, handed_over_by: handed ? operator?.id : null,
          returned_at: r.status === 'RETURNED' ? end.plus({ minutes: r.late_fee ? 50 : -10 }).toJSDate() : null, returned_by: r.status === 'RETURNED' ? operator?.id : null,
          cancelled_at: closedBy ? start.minus({ hours: 5 }).toJSDate() : null, cancelled_by: r.status === 'CANCELLED' ? customer.id : r.status === 'REJECTED' ? operator?.id : null,
          cancel_reason: r.reason ?? null, created_at: start.minus({ days: 1 }).toJSDate(),
        },
      });
      if (r.paid) {
        // Klub kassasiga tushgan to'lov (komissiyasiz) + ledger — FinanceService.markPaid bilan bir xil yozuvlar
        const paymentId = uuidv7();
        await tx.payments.create({
          data: {
            id: paymentId, club_id: it.club_id, branch_id: it.branch_id, rental_id: id, user_id: customer.id, amount: total, method: r.paid, provider: 'MANUAL',
            status: 'PAID', paid_at: start.toJSDate(), received_by: operator?.id, commission_bps: 0, commission_amount: 0n, club_amount: total,
          },
        });
        await tx.ledger_entries.createMany({
          data: [
            { id: uuidv7(), account: 'CUSTOMER', account_id: customer.id, direction: 'DEBIT', amount: total, ref_type: 'payment', ref_id: paymentId },
            { id: uuidv7(), account: 'CLUB', account_id: it.club_id, direction: 'CREDIT', amount: total, ref_type: 'payment', ref_id: paymentId },
          ],
        });
      }
    });
    orders++;
  }
  if (orders) console.log(`Demo rentals: ${orders}`);
}
