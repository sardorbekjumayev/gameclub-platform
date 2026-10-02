import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { uuidv7 } from '../../src/common/utils/id';
import { PERMISSIONS, SYSTEM_ROLES } from '../../src/modules/rbac/catalog';

const prisma = new PrismaClient();

/** Idempotent: qayta ishga tushirilsa takror yaratmaydi. */
async function seedRbac() {
  for (const code of PERMISSIONS) {
    await prisma.permissions.upsert({ where: { code }, update: {}, create: { id: uuidv7(), code } });
  }
  const perms = new Map((await prisma.permissions.findMany()).map((p) => [p.code, p.id]));
  for (const r of SYSTEM_ROLES) {
    const role = await prisma.roles.upsert({
      where: { code: r.code },
      update: { name: r.name, scope_type: r.scope_type, is_system: true },
      create: { id: uuidv7(), code: r.code, name: r.name, scope_type: r.scope_type, is_system: true },
    });
    await prisma.role_permissions.deleteMany({ where: { role_id: role.id } });
    await prisma.role_permissions.createMany({
      data: r.permissions.map((p) => ({ role_id: role.id, permission_id: perms.get(p)! })),
    });
  }
}

async function seedSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) return;
  const role = await prisma.roles.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) return;
  const user = await prisma.users.create({
    data: {
      id: uuidv7(), type: 'PLATFORM', email, first_name: 'Super', last_name: 'Admin',
      password_hash: await argon2.hash(password, { type: argon2.argon2id }), email_verified_at: new Date(),
    },
  });
  await prisma.user_roles.create({ data: { id: uuidv7(), user_id: user.id, role_id: role.id } });
  console.log(`Super admin: ${email}`);
}

/**
 * Tarif rejalari (docs/02-DATABASE.md §6). Nomlar hujjatda bor; limit va narxlar hujjatda yo'q —
 * VAQTINCHALIK qiymatlar, biznes tasdiqlagach yangilanadi. null — cheksiz. Narx tiyinda.
 */
const PLANS = [
  { code: 'FREE', name: 'Free', price_per_month: 0n, limits: { branches: 1, devices: 10, staff: 3, analytics: false, online_booking: true, api_access: false, pc_agent: false } },
  { code: 'STARTER', name: 'Starter', price_per_month: 29_900_000n, limits: { branches: 2, devices: 40, staff: 10, analytics: true, online_booking: true, api_access: false, pc_agent: false } },
  { code: 'PRO', name: 'Pro', price_per_month: 79_900_000n, limits: { branches: 5, devices: 150, staff: 50, analytics: true, online_booking: true, api_access: true, pc_agent: true } },
  { code: 'ENTERPRISE', name: 'Enterprise', price_per_month: 0n, limits: { branches: null, devices: null, staff: null, analytics: true, online_booking: true, api_access: true, pc_agent: true } },
];

async function seedPlans() {
  for (const p of PLANS) {
    await prisma.plans.upsert({ where: { code: p.code }, update: { name: p.name }, create: { id: uuidv7(), ...p } });
  }
}

/** Dev: plans seed'dan oldin yaratilgan klublarga PRO sinov obunasi (30 kun). */
async function backfillTrials() {
  if (process.env.NODE_ENV === 'production') return;
  const pro = await prisma.plans.findUniqueOrThrow({ where: { code: 'PRO' } });
  const clubs = await prisma.clubs.findMany({ where: { deleted_at: null, subscriptions: { none: {} } }, select: { id: true } });
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86400_000);
  for (const c of clubs) {
    await prisma.subscriptions.create({ data: { id: uuidv7(), club_id: c.id, plan_id: pro.id, status: 'TRIALING', current_period_start: now, current_period_end: end, trial_ends_at: end } });
  }
  if (clubs.length) console.log(`Trial subscriptions: ${clubs.length}`);
}

async function main() {
  await seedRbac();
  await seedSuperAdmin();
  await seedPlans();
  await backfillTrials();
  console.log('Seed done');
}

main().finally(() => prisma.$disconnect());
