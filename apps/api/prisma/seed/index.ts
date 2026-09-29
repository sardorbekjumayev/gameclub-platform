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

async function main() {
  await seedRbac();
  await seedSuperAdmin();
  console.log('Seed done');
}

main().finally(() => prisma.$disconnect());
