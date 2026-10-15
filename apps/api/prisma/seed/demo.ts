import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { uuidv7 } from '../../src/common/utils/id';

/**
 * Dev demo ma'lumotlari: har bir rol uchun foydalanuvchi, 3 ta klub (xonalar, o'rindiq sxemasi, tariflar)
 * va moderatsiyadagi bitta ariza. Takroriy ishga tushirilsa mavjudlarini o'tkazib yuboradi.
 * Production'da ishlamaydi.
 */
export const DEMO_PASSWORD = 'Demo12345!';

type UserSeed = { email: string; phone: string; first_name: string; last_name: string; type: 'PLATFORM' | 'STAFF' | 'CUSTOMER' };

const HOURS = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '10:00', close: '04:00' }]]));
const SUM = (n: number) => BigInt(n * 100); // so'm → tiyin

type Decor = { kind: string; x: number; y: number };
type RoomSeed = { decor?: Decor[]; name: string; type: string; cols: number; rows: number; prefix: string; device_type: string; price: number; seats: [number, number][]; specs?: object };

/** Qatorlab joylashgan o'rindiqlar: har qator orasida o'tish yo'lagi. */
const rowsOf = (cols: number, rowYs: number[], skipX: number[] = []): [number, number][] =>
  rowYs.flatMap((y) => Array.from({ length: cols }, (_, x) => [x, y] as [number, number]).filter(([x]) => !skipX.includes(x)));

const line = (kind: string, xs: number[], y: number): Decor[] => xs.map((x) => ({ kind, x, y }));
const col = (kind: string, x: number, ys: number[]): Decor[] => ys.map((y) => ({ kind, x, y }));

const ROOMS: Record<string, RoomSeed[]> = {
  big: [
    { name: 'Umumiy zal', type: 'STANDARD', cols: 10, rows: 5, prefix: 'PC', device_type: 'PC', price: 12_000, seats: rowsOf(10, [0, 1, 3, 4], [5]), decor: [...line('AISLE', [0, 1, 2, 3, 4, 5, 6, 7, 8], 2), ...col('AISLE', 5, [0, 1, 3, 4]), { kind: 'ENTRANCE', x: 9, y: 2 }], specs: { cpu: 'i5-12400F', gpu: 'RTX 3060', ram: '16GB', monitor: '24" 165Hz' } },
    { name: 'VIP', type: 'VIP', cols: 6, rows: 3, prefix: 'VIP', device_type: 'PC', price: 25_000, seats: rowsOf(6, [0, 2], [2, 3]), decor: [{ kind: 'TV', x: 2, y: 1 }, { kind: 'TV', x: 3, y: 1 }, { kind: 'ENTRANCE', x: 5, y: 1 }], specs: { cpu: 'i7-13700K', gpu: 'RTX 4070 Ti', ram: '32GB', monitor: '27" 240Hz' } },
    { name: 'Konsol xonasi', type: 'CONSOLE', cols: 4, rows: 2, prefix: 'PS', device_type: 'PS5', price: 30_000, seats: [[0, 0], [2, 0], [0, 1], [2, 1]], decor: [{ kind: 'TV', x: 1, y: 0 }, { kind: 'TV', x: 3, y: 0 }, { kind: 'ENTRANCE', x: 3, y: 1 }] },
  ],
  small: [
    { name: 'Asosiy zal', type: 'STANDARD', cols: 8, rows: 4, prefix: 'PC', device_type: 'PC', price: 10_000, seats: rowsOf(8, [0, 2, 3], [4]), decor: [...line('AISLE', [0, 1, 2, 3, 4, 5, 6], 1), { kind: 'ENTRANCE', x: 7, y: 1 }, { kind: 'CASHIER', x: 4, y: 3 }], specs: { cpu: 'Ryzen 5 5600', gpu: 'RTX 3050', ram: '16GB', monitor: '24" 144Hz' } },
    { name: 'Bootcamp', type: 'BOOTCAMP', cols: 5, rows: 2, prefix: 'BC', device_type: 'PC', price: 20_000, seats: rowsOf(5, [0]), decor: [{ kind: 'ENTRANCE', x: 4, y: 1 }], specs: { cpu: 'i7-12700F', gpu: 'RTX 4060 Ti', ram: '32GB', monitor: '25" 280Hz' } },
  ],
};

const CLUBS = [
  {
    slug: 'demo-cyber-arena',
    name: 'Cyber Arena',
    owner: 'owner',
    description: 'Toshkentdagi eng katta kiberklub: 40+ PC, VIP xona va PS5.',
    branches: [
      { name: 'Chilonzor', address: 'Toshkent, Chilonzor tumani, Bunyodkor ko\'chasi 12', lat: 41.2856, lng: 69.2040, rooms: ROOMS.big },
      { name: 'Yunusobod', address: 'Toshkent, Yunusobod tumani, Amir Temur ko\'chasi 107', lat: 41.3650, lng: 69.2870, rooms: ROOMS.small },
    ],
  },
  {
    slug: 'demo-pixel-club',
    name: 'Pixel Club',
    owner: 'owner2',
    description: 'Samarqanddagi qulay gaming klub, bootcamp xonasi bilan.',
    branches: [{ name: 'Registon', address: 'Samarqand, Registon ko\'chasi 5', lat: 39.6548, lng: 66.9757, rooms: ROOMS.small }],
  },
  {
    slug: 'demo-level-up',
    name: 'Level Up',
    owner: 'owner3',
    description: 'Buxoro markazidagi klub.',
    branches: [{ name: 'Markaz', address: 'Buxoro, Mustaqillik ko\'chasi 20', lat: 39.7747, lng: 64.4286, rooms: ROOMS.small }],
  },
] as const;

const USERS: Record<string, UserSeed> = {
  support: { email: 'support@gameclub.local', phone: '+998900000010', first_name: 'Sardor', last_name: 'Support', type: 'PLATFORM' },
  owner: { email: 'owner@gameclub.local', phone: '+998900000001', first_name: 'Jasur', last_name: 'Egasi', type: 'STAFF' },
  clubadmin: { email: 'clubadmin@gameclub.local', phone: '+998900000002', first_name: 'Dilshod', last_name: 'Admin', type: 'STAFF' },
  branchadmin: { email: 'branchadmin@gameclub.local', phone: '+998900000003', first_name: 'Aziz', last_name: 'Filial', type: 'STAFF' },
  operator: { email: 'operator@gameclub.local', phone: '+998900000004', first_name: 'Otabek', last_name: 'Operator', type: 'STAFF' },
  owner2: { email: 'owner2@gameclub.local', phone: '+998900000005', first_name: 'Bekzod', last_name: 'Pixel', type: 'STAFF' },
  owner3: { email: 'owner3@gameclub.local', phone: '+998900000006', first_name: 'Rustam', last_name: 'Level', type: 'STAFF' },
  pending: { email: 'pending@gameclub.local', phone: '+998900000007', first_name: 'Nodir', last_name: 'Ariza', type: 'STAFF' },
  customer: { email: 'customer@gameclub.local', phone: '+998900000100', first_name: 'Alisher', last_name: 'Mijoz', type: 'CUSTOMER' },
};

export async function seedDemo(prisma: PrismaClient) {
  if (process.env.NODE_ENV === 'production') return;
  const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const roles = new Map((await prisma.roles.findMany()).map((r) => [r.code, r.id]));
  const users = new Map<string, string>();

  for (const [key, u] of Object.entries(USERS)) {
    const existing = await prisma.users.findFirst({ where: { OR: [{ email: u.email }, { phone: u.phone }] } });
    const user =
      existing ??
      (await prisma.users.create({
        data: { id: uuidv7(), ...u, password_hash: hash, status: 'ACTIVE', email_verified_at: new Date(), phone_verified_at: new Date() },
      }));
    users.set(key, user.id);
  }

  const grant = async (userKey: string, role: string, club_id: string | null = null, branch_id: string | null = null) => {
    const user_id = users.get(userKey)!;
    const role_id = roles.get(role)!;
    const has = await prisma.user_roles.findFirst({ where: { user_id, role_id, club_id, branch_id } });
    if (!has) await prisma.user_roles.create({ data: { id: uuidv7(), user_id, role_id, club_id, branch_id } });
  };
  await grant('support', 'SUPPORT');
  await grant('customer', 'CUSTOMER');

  const admin = await prisma.users.findFirst({ where: { type: 'PLATFORM', email: process.env.SUPER_ADMIN_EMAIL ?? 'admin@gameclub.local' } });
  let firstBranch: string | null = null;
  let firstClub: string | null = null;

  for (const [ci, c] of CLUBS.entries()) {
    let club = await prisma.clubs.findUnique({ where: { slug: c.slug } });
    if (club) {
      if (c.owner === 'owner') {
        firstClub = club.id;
        firstBranch = (await prisma.branches.findFirst({ where: { club_id: club.id }, orderBy: { created_at: 'asc' } }))?.id ?? null;
      }
      continue;
    }
    club = await prisma.clubs.create({
      data: {
        id: uuidv7(), owner_id: users.get(c.owner)!, name: c.name, slug: c.slug, description: c.description, phone: USERS[c.owner].phone,
        amenities: ['wifi', 'parking', 'snacks'], status: 'ACTIVE', approved_at: new Date(), approved_by: admin?.id,
        // Demo o'tkazma kartasi (haqiqiy emas) — mijoz kartaga o'tkazma oqimini sinashi uchun
        transfer_card_number: `8600${String(ci + 1).padStart(4, '0')}12345678`, transfer_card_holder: `${USERS[c.owner].first_name} ${USERS[c.owner].last_name}`.toUpperCase(),
      },
    });
    await grant(c.owner, 'CLUB_OWNER', club.id);

    for (const [bi, b] of c.branches.entries()) {
      const branch = await prisma.branches.create({
        data: {
          id: uuidv7(), club_id: club.id, name: b.name, slug: `${c.slug.replace('demo-', '')}-${bi + 1}`, address: b.address,
          latitude: b.lat, longitude: b.lng, phone: USERS[c.owner].phone, working_hours: HOURS, amenities: ['wifi', 'snacks'],
          description: `${c.name} — ${b.name} filiali`,
        },
      });
      if (c.owner === 'owner' && bi === 0) {
        firstClub = club.id;
        firstBranch = branch.id;
      }
      for (const [ri, r] of b.rooms.entries()) {
        const room = await prisma.rooms.create({
          data: { id: uuidv7(), club_id: club.id, branch_id: branch.id, name: r.name, type: r.type, position: ri, grid_cols: r.cols, grid_rows: r.rows, capacity: r.seats.length, decor: r.decor ?? [] },
        });
        await prisma.tariffs.create({
          data: { id: uuidv7(), club_id: club.id, branch_id: branch.id, room_id: room.id, name: `${r.name} tarifi`, price_per_hour: SUM(r.price), priority: 10 },
        });
        await prisma.devices.createMany({
          data: r.seats.map(([x, y], i) => ({
            id: uuidv7(), club_id: club!.id, branch_id: branch.id, room_id: room.id, name: `${r.prefix}-${String(i + 1).padStart(2, '0')}`,
            type: r.device_type, specs: r.specs, position_order: i, layout: { x, y },
          })),
        });
      }
    }
    console.log(`Demo club: ${c.name}`);
  }

  // Demo paketlar (paketsiz xona tariflariga): "3 soat" ≈ 2.5 soat narxida, tungi 8 soat ≈ 5 soat narxida
  const demoClubs = await prisma.clubs.findMany({ where: { slug: { in: CLUBS.map((c) => c.slug) } }, select: { id: true } });
  const bare = await prisma.tariffs.findMany({ where: { room_id: { not: null }, deleted_at: null, club_id: { in: demoClubs.map((c) => c.id) }, packages: { none: {} } } });
  for (const t of bare) {
    const round = (v: bigint) => (v / 100_000n) * 100_000n; // 1 000 so'mga yaxlitlash
    await prisma.tariff_packages.createMany({
      data: [
        { id: uuidv7(), tariff_id: t.id, club_id: t.club_id, branch_id: t.branch_id, name: '3 soat', duration_minutes: 180, price: round((t.price_per_hour * 5n) / 2n), position: 0 },
        { id: uuidv7(), tariff_id: t.id, club_id: t.club_id, branch_id: t.branch_id, name: 'Tungi paket', duration_minutes: 480, price: round(t.price_per_hour * 5n), start_time: '22:00', end_time: '08:00', position: 1 },
      ],
    });
  }
  if (bare.length) console.log(`Demo packages: ${bare.length * 2}`);

  // Oldin yaratilgan demo xonalarga bezak (bo'sh bo'lsa)
  for (const c of CLUBS) {
    for (const b of c.branches) {
      for (const r of b.rooms) {
        if (!r.decor) continue;
        await prisma.rooms.updateMany({ where: { name: r.name, decor: { equals: [] }, branch: { name: b.name, club: { slug: c.slug } } }, data: { decor: r.decor } });
      }
    }
  }

  if (firstClub && firstBranch) {
    await grant('clubadmin', 'CLUB_ADMIN', firstClub);
    await grant('branchadmin', 'BRANCH_ADMIN', firstClub, firstBranch);
    await grant('operator', 'OPERATOR', firstClub, firstBranch);
  }

  // Moderatsiyadagi ariza (super admin "Tasdiqlash"ni sinashi uchun)
  if (!(await prisma.clubs.findUnique({ where: { slug: 'demo-game-zone-pending' } }))) {
    const club = await prisma.clubs.create({
      data: { id: uuidv7(), owner_id: users.get('pending')!, name: 'Game Zone Namangan', slug: 'demo-game-zone-pending', description: 'Yangi ariza — moderatsiyada.', status: 'PENDING_APPROVAL' },
    });
    await grant('pending', 'CLUB_OWNER', club.id);
    await prisma.branches.create({
      data: { id: uuidv7(), club_id: club.id, name: 'Namangan markaz', slug: 'game-zone-1', address: 'Namangan, Navoiy ko\'chasi 3', latitude: 40.9983, longitude: 71.6726, working_hours: HOURS },
    });
  }
}
