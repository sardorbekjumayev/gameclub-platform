import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { PageQuery, pageArgs } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { maskPhone } from '../../common/utils/codes';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { uuidv7 } from '../../common/utils/id';
import { REDIS } from '../../infra/redis/redis.module';
import { SmsProvider } from '../../infra/sms/sms.provider';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { accessCutoffKey, assertStrongPassword, generateTempPassword, hashPassword } from '../auth/password';
import { ACCESS_TTL_S } from '../auth/token.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { branchesInClub, can } from '../rbac/access';
import { Grant, RbacService } from '../rbac/rbac.service';
import { Actor } from './clubs.service';
import { AcceptInvitationDto, AddStaffDto, InviteStaffDto, ResetStaffPasswordDto, UpdateStaffDto } from './dto/clubs.dto';
import { EntitlementsService } from './entitlements.service';

/** Rol darajasi — o'zidan yuqori/teng rol berib bo'lmaydi (privilege escalation oldi, §5.3). */
/** Taklif havolasining amal qilish muddati. */
const INVITE_TTL_MS = 72 * 3600_000;

const RANK: Record<string, number> = { SUPER_ADMIN: 100, CLUB_OWNER: 50, CLUB_ADMIN: 40, BRANCH_ADMIN: 30, OPERATOR: 20 };
/** Custom (klub) rollar darajasi noma'lum — xavfsiz tomonga: scope bo'yicha eng yuqori tizim roli darajasi. */
const CUSTOM_RANK: Record<string, number> = { CLUB: RANK.CLUB_ADMIN, BRANCH: RANK.BRANCH_ADMIN };

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly entitlements: EntitlementsService,
    private readonly sms: SmsProvider,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private myRank(grants: Grant[], clubId: string) {
    return Math.max(0, ...grants.filter((g) => g.scope_type === 'PLATFORM' || g.club_id === clubId).map((g) => RANK[g.role] ?? 0));
  }

  private async validateAssignment(clubId: string, role: string, branchId: string | undefined, grants: Grant[]) {
    if ((RANK[role] ?? 0) >= this.myRank(grants, clubId)) throw new AppException('FORBIDDEN', 'Cannot grant a role equal to or above your own');
    const needsBranch = role === 'BRANCH_ADMIN' || role === 'OPERATOR';
    if (needsBranch && !branchId) throw new AppException('VALIDATION_ERROR', 'branch_id is required for this role', { field: 'branch_id' });
    if (branchId) {
      const b = await this.prisma.branches.findFirst({ where: { id: branchId, club_id: clubId, deleted_at: null } });
      if (!b) throw new AppException('NOT_FOUND', 'Branch not found');
      if (!can(grants, 'staff.create', { club_id: clubId, branch_id: branchId })) throw new AppException('NOT_FOUND', 'Branch not found');
    }
    return needsBranch ? branchId! : null;
  }

  async list(clubId: string, grants: Grant[]) {
    const allowed = branchesInClub(grants, 'staff.view', clubId);
    const rows = await this.prisma.user_roles.findMany({
      where: { club_id: clubId, ...(allowed ? { branch_id: { in: allowed } } : {}) },
      include: { role: true, user: { select: { id: true, phone: true, email: true, first_name: true, last_name: true, status: true, last_login_at: true, must_change_password: true } } },
      orderBy: { created_at: 'asc' },
    });
    const branches = await this.prisma.branches.findMany({ where: { club_id: clubId }, select: { id: true, name: true } });
    const names = new Map(branches.map((b) => [b.id, b.name]));
    return rows.map((r) => ({ id: r.id, role: r.role.code, branch_id: r.branch_id, branch_name: r.branch_id ? names.get(r.branch_id) ?? null : null, created_at: r.created_at, user: r.user }));
  }

  async add(clubId: string, dto: AddStaffDto, grants: Grant[], actor: Actor) {
    const branchId = await this.validateAssignment(clubId, dto.role, dto.branch_id, grants);
    await this.entitlements.assertWithin(clubId, 'staff');
    const role = await this.prisma.roles.findUniqueOrThrow({ where: { code: dto.role } });
    const result = await this.prisma.$transaction(async (tx) => {
      let user = await tx.users.findUnique({ where: { phone: dto.phone } });
      if (!user) {
        if (!dto.password) throw new AppException('VALIDATION_ERROR', 'password is required for a new staff member', { field: 'password' });
        user = await tx.users.create({ data: { id: uuidv7(), type: 'STAFF', phone: dto.phone, first_name: dto.first_name, last_name: dto.last_name, status: 'ACTIVE' } });
      }
      if (dto.password && !user.password_hash) {
        await tx.users.update({ where: { id: user.id }, data: { password_hash: await argon2.hash(dto.password, { type: argon2.argon2id }) } });
      }
      const exists = await tx.user_roles.findFirst({ where: { user_id: user.id, club_id: clubId, branch_id: branchId, role_id: role.id } });
      if (exists) throw new AppException('CONFLICT', 'Staff member already has this role');
      const ur = await tx.user_roles.create({ data: { id: uuidv7(), user_id: user.id, role_id: role.id, club_id: clubId, branch_id: branchId, granted_by: actor.id } });
      await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'staff.add', target_type: 'user', target_id: user.id, new_value: { role: dto.role, branch_id: branchId }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
      return { user_role_id: ur.id, user_id: user.id };
    });
    await this.rbac.invalidate(result.user_id);
    return result;
  }

  private async loadAssignment(clubId: string, userRoleId: string, grants: Grant[]) {
    const ur = await this.prisma.user_roles.findFirst({ where: { id: userRoleId, club_id: clubId }, include: { role: true } });
    if (!ur) throw new AppException('NOT_FOUND', 'Staff not found');
    if (ur.role.code === 'CLUB_OWNER') throw new AppException('FORBIDDEN', 'Owner role cannot be changed here');
    if ((RANK[ur.role.code] ?? 0) >= this.myRank(grants, clubId)) throw new AppException('FORBIDDEN', 'Cannot modify a role equal to or above your own');
    if (ur.branch_id && !can(grants, 'staff.update', { club_id: clubId, branch_id: ur.branch_id })) throw new AppException('NOT_FOUND', 'Staff not found');
    return ur;
  }

  async update(clubId: string, userRoleId: string, dto: UpdateStaffDto, grants: Grant[], actor: Actor) {
    const ur = await this.loadAssignment(clubId, userRoleId, grants);
    const branchId = await this.validateAssignment(clubId, dto.role, dto.branch_id, grants);
    const role = await this.prisma.roles.findUniqueOrThrow({ where: { code: dto.role } });
    const updated = await this.prisma.user_roles.update({ where: { id: ur.id }, data: { role_id: role.id, branch_id: branchId } });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'staff.update', target_type: 'user', target_id: ur.user_id, old_value: { role: ur.role.code, branch_id: ur.branch_id }, new_value: { role: dto.role, branch_id: branchId }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    await this.rbac.invalidate(ur.user_id);
    return updated;
  }

  async remove(clubId: string, userRoleId: string, grants: Grant[], actor: Actor) {
    const ur = await this.loadAssignment(clubId, userRoleId, grants);
    await this.prisma.user_roles.delete({ where: { id: ur.id } });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'staff.remove', target_type: 'user', target_id: ur.user_id, old_value: { role: ur.role.code, branch_id: ur.branch_id }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    await this.rbac.invalidate(ur.user_id);
    return { deleted: true };
  }

  // ---------- Parolni tiklash (ierarxiya bo'yicha) ----------

  /**
   * Xodim parolini tiklash: vaqtinchalik parol (yoki tiklovchi kiritgani) → argon2 hash, `must_change_password`,
   * barcha refresh/access token'lar bekor, audit, foydalanuvchiga bildirishnoma (parolsiz).
   * Faqat o'zidan past darajadagi shu klub xodimi; platforma akkaunti, o'zi va boshqa klub xodimi — yo'q.
   */
  async resetPassword(clubId: string, userId: string, dto: ResetStaffPasswordDto, grants: Grant[], actor: Actor) {
    if (userId === actor.id) throw new AppException('FORBIDDEN', 'Use change password for your own account', { reason: 'SELF_RESET' });
    const user = await this.prisma.users.findFirst({ where: { id: userId, deleted_at: null }, select: { id: true, type: true } });
    const roles = user ? await this.prisma.user_roles.findMany({ where: { user_id: userId }, include: { role: true } }) : [];
    const now = new Date();
    const here = roles.filter((r) => r.club_id === clubId && r.role.code !== 'CUSTOMER' && (!r.expires_at || r.expires_at > now));
    // Shu klub xodimi emas (yoki boshqa klubniki) — mavjudligini oshkor qilmaymiz
    if (!user || !here.length) throw new AppException('NOT_FOUND', 'Staff not found');
    if (here.some((r) => r.branch_id && !can(grants, 'staff.reset_password', { club_id: clubId, branch_id: r.branch_id }))) throw new AppException('NOT_FOUND', 'Staff not found');

    if (user.type === 'PLATFORM' || roles.some((r) => r.role.scope_type === 'PLATFORM' && r.role.code !== 'CUSTOMER')) {
      throw new AppException('FORBIDDEN', 'Platform accounts cannot be reset here', { reason: 'PLATFORM_ACCOUNT' });
    }
    // Boshqa klubda ham xodim/ega bo'lsa — faqat platforma (aks holda bir klub boshqa klub akkauntini egallab olishi mumkin)
    const actorPlatform = grants.some((g) => g.scope_type === 'PLATFORM' && g.permissions.includes('staff.reset_password'));
    if (!actorPlatform) {
      const elsewhere = roles.some((r) => r.club_id && r.club_id !== clubId && r.role.code !== 'CUSTOMER')
        || !!(await this.prisma.clubs.findFirst({ where: { owner_id: userId, id: { not: clubId } }, select: { id: true } }));
      if (elsewhere) throw new AppException('FORBIDDEN', 'Staff member also belongs to another club; contact platform support', { reason: 'OTHER_CLUB' });
    }
    const owner = await this.prisma.clubs.findFirst({ where: { id: clubId, owner_id: userId }, select: { id: true } });
    const targetRank = Math.max(owner ? RANK.CLUB_OWNER : 0, ...here.map((r) => RANK[r.role.code] ?? CUSTOM_RANK[r.role.scope_type] ?? 0));
    if (targetRank >= this.myRank(grants, clubId)) throw new AppException('FORBIDDEN', 'Cannot reset the password of a role equal to or above your own', { reason: 'RANK' });

    if (dto.password) assertStrongPassword(dto.password);
    const password = dto.password ?? generateTempPassword();
    const hash = await hashPassword(password);
    const revoked = await this.prisma.$transaction(async (tx) => {
      await tx.users.update({ where: { id: userId }, data: { password_hash: hash, must_change_password: true } });
      const r = await tx.refresh_tokens.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
      // Parolning o'zi audit'ga yozilmaydi (CLAUDE.md qoida 9)
      await this.audit.log({
        actor_id: actor.id, club_id: clubId, action: 'staff.password_reset', target_type: 'user', target_id: userId,
        new_value: { roles: here.map((x) => x.role.code), generated: !dto.password, sessions_revoked: r.count },
        ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id,
      }, tx);
      return r.count;
    });
    // Hali amal qilayotgan access token'lar (15 daq) ham rad etiladi; ochiq socketlar uziladi
    await this.redis.set(accessCutoffKey(userId), String(Math.floor(Date.now() / 1000)), 'EX', ACCESS_TTL_S + 60);
    this.realtime.disconnectUser(userId);
    const club = actorPlatform ? null : await this.prisma.clubs.findUnique({ where: { id: clubId }, select: { name: true } });
    await this.notifications.notify([userId], 'PASSWORD_RESET_BY_ADMIN', { club: club?.name ?? 'Zonup' }, { club_id: clubId });
    return { user_id: userId, temporary_password: password, generated: !dto.password, must_change_password: true, sessions_revoked: revoked };
  }

  // ---------- Takliflar (docs/01-API.md §4.2) ----------

  async invitations(clubId: string, grants: Grant[]) {
    const allowed = branchesInClub(grants, 'staff.view', clubId);
    const rows = await this.prisma.staff_invitations.findMany({
      where: { club_id: clubId, ...(allowed ? { branch_id: { in: allowed } } : {}) },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    const roles = new Map((await this.prisma.roles.findMany()).map((r) => [r.id, r.code]));
    const now = Date.now();
    return rows.map(({ token_hash, ...r }) => ({
      ...r,
      role: roles.get(r.role_id),
      status: r.status === 'PENDING' && r.expires_at.getTime() < now ? 'EXPIRED' : r.status,
    }));
  }

  async invite(clubId: string, dto: InviteStaffDto, grants: Grant[], actor: Actor) {
    const branchId = await this.validateAssignment(clubId, dto.role, dto.branch_id, grants);
    await this.entitlements.assertWithin(clubId, 'staff');
    const role = await this.prisma.roles.findUniqueOrThrow({ where: { code: dto.role } });
    const token = randomToken();
    const inv = await this.prisma.$transaction(async (tx) => {
      // Shu telefonga oldingi faol taklif bekor qilinadi
      await tx.staff_invitations.updateMany({ where: { club_id: clubId, phone_or_email: dto.phone, status: 'PENDING' }, data: { status: 'REVOKED' } });
      const row = await tx.staff_invitations.create({
        data: { id: uuidv7(), club_id: clubId, branch_id: branchId, role_id: role.id, phone_or_email: dto.phone, token_hash: sha256(token), invited_by: actor.id, expires_at: new Date(Date.now() + INVITE_TTL_MS) },
      });
      await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'staff.invite', target_type: 'staff_invitation', target_id: row.id, new_value: { role: dto.role, branch_id: branchId }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
      return row;
    });
    const link = `${this.config.get('ADMIN_APP_URL')}/invite?token=${token}`;
    await this.sms.send(dto.phone, `Zonup: sizni xodim sifatida taklif qilishdi. ${link}`);
    const { token_hash, ...safe } = inv;
    // Havola faqat dev'da qaytariladi (SMS mock bo'lgani uchun); prod'da faqat SMS orqali.
    return { ...safe, role: dto.role, ...(this.config.get('NODE_ENV') !== 'production' ? { invite_url: link, token } : {}) };
  }

  async revokeInvitation(clubId: string, invitationId: string, grants: Grant[], actor: Actor) {
    const inv = await this.prisma.staff_invitations.findFirst({ where: { id: invitationId, club_id: clubId } });
    if (!inv || (inv.branch_id && !can(grants, 'staff.create', { club_id: clubId, branch_id: inv.branch_id }))) throw new AppException('NOT_FOUND', 'Invitation not found');
    if (inv.status !== 'PENDING') throw new AppException('CONFLICT', 'Invitation is not pending');
    await this.prisma.staff_invitations.update({ where: { id: inv.id }, data: { status: 'REVOKED' } });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'staff.invite_revoke', target_type: 'staff_invitation', target_id: inv.id, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return { revoked: true };
  }

  /** Ommaviy: taklif ma'lumoti (qabul sahifasi uchun). */
  async previewInvitation(token: string) {
    const inv = await this.findPending(token);
    const [club, role, branch, user] = await Promise.all([
      this.prisma.clubs.findUniqueOrThrow({ where: { id: inv.club_id }, select: { name: true } }),
      this.prisma.roles.findUniqueOrThrow({ where: { id: inv.role_id } }),
      inv.branch_id ? this.prisma.branches.findUnique({ where: { id: inv.branch_id }, select: { name: true } }) : null,
      this.prisma.users.findUnique({ where: { phone: inv.phone_or_email }, select: { password_hash: true } }),
    ]);
    return { club_name: club.name, branch_name: branch?.name ?? null, role: role.code, phone: maskPhone(inv.phone_or_email), expires_at: inv.expires_at, has_account: !!user?.password_hash };
  }

  private async findPending(token: string) {
    const inv = await this.prisma.staff_invitations.findUnique({ where: { token_hash: sha256(token) } });
    if (!inv || inv.status !== 'PENDING' || inv.expires_at < new Date()) throw new AppException('NOT_FOUND', 'Invitation is invalid or expired');
    return inv;
  }

  /** Taklifni qabul qilish: foydalanuvchi yaratiladi/yangilanadi, rol biriktiriladi. user_id qaytaradi. */
  async acceptInvitation(dto: AcceptInvitationDto) {
    const inv = await this.findPending(dto.token);
    const hash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const userId = await this.prisma.$transaction(async (tx) => {
      // Parallel qabul qilishdan himoya: faqat PENDING holatdan o'tkaziladi
      const claimed = await tx.staff_invitations.updateMany({ where: { id: inv.id, status: 'PENDING' }, data: { status: 'ACCEPTED', accepted_at: new Date() } });
      if (claimed.count !== 1) throw new AppException('NOT_FOUND', 'Invitation is invalid or expired');
      let user = await tx.users.findUnique({ where: { phone: inv.phone_or_email } });
      if (user) {
        if (user.status === 'BLOCKED' || user.deleted_at) throw new AppException('FORBIDDEN', 'Account disabled');
        user = await tx.users.update({
          where: { id: user.id },
          data: { password_hash: user.password_hash ?? hash, phone_verified_at: user.phone_verified_at ?? new Date(), first_name: user.first_name ?? dto.first_name, last_name: user.last_name ?? dto.last_name },
        });
        // Mavjud akkaunt paroli taklif orqali almashtirilmaydi (akkauntni egallab olish oldi)
        if (user.password_hash !== hash && !(await argon2.verify(user.password_hash!, dto.password))) throw new AppException('UNAUTHORIZED', 'Invalid credentials');
      } else {
        user = await tx.users.create({ data: { id: uuidv7(), type: 'STAFF', phone: inv.phone_or_email, first_name: dto.first_name, last_name: dto.last_name, password_hash: hash, phone_verified_at: new Date(), status: 'ACTIVE' } });
      }
      const exists = await tx.user_roles.findFirst({ where: { user_id: user.id, club_id: inv.club_id, branch_id: inv.branch_id, role_id: inv.role_id } });
      if (!exists) await tx.user_roles.create({ data: { id: uuidv7(), user_id: user.id, role_id: inv.role_id, club_id: inv.club_id, branch_id: inv.branch_id, granted_by: inv.invited_by } });
      await this.audit.log({ actor_id: user.id, club_id: inv.club_id, action: 'staff.invite_accept', target_type: 'staff_invitation', target_id: inv.id }, tx);
      return user.id;
    });
    await this.rbac.invalidate(userId);
    return userId;
  }

  // ---------- Klub mijozlari ----------

  async customers(clubId: string, q: PageQuery, grants: Grant[]) {
    const allowed = branchesInClub(grants, 'customers.view', clubId);
    // Operator uchun telefon maskalanadi (docs/01-API.md §11)
    const fullPhone = grants.some((g) => ['SUPER_ADMIN', 'CLUB_OWNER', 'CLUB_ADMIN'].includes(g.role) && (g.scope_type === 'PLATFORM' || g.club_id === clubId));
    const groups = await this.prisma.bookings.groupBy({
      by: ['customer_id'],
      where: { club_id: clubId, customer_id: { not: null }, ...(allowed ? { branch_id: { in: allowed } } : {}) },
      _count: true,
      _sum: { paid_amount: true },
      _max: { start_at: true },
      orderBy: { _max: { start_at: 'desc' } },
    });
    const ids = groups.map((g) => g.customer_id!);
    const users = await this.prisma.users.findMany({
      where: { id: { in: ids }, ...(q.q ? { OR: [{ phone: { contains: q.q } }, { first_name: { contains: q.q, mode: 'insensitive' } }, { last_name: { contains: q.q, mode: 'insensitive' } }] } : {}) },
      select: { id: true, phone: true, first_name: true, last_name: true, no_show_count: true, booking_blocked_until: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const notes = await this.prisma.customer_notes.findMany({ where: { club_id: clubId, user_id: { in: ids } } });
    const noteBy = new Map(notes.map((n) => [n.user_id, n.note]));
    const all = groups
      .filter((g) => byId.has(g.customer_id!))
      .map((g) => {
        const u = byId.get(g.customer_id!)!;
        return { ...u, phone: fullPhone ? u.phone : maskPhone(u.phone), bookings_count: g._count, total_paid: g._sum.paid_amount ?? 0n, last_visit_at: g._max.start_at, note: noteBy.get(u.id) ?? null };
      });
    const { skip, take } = pageArgs(q);
    return new Paginated(all.slice(skip, skip + take), { page: q.page, limit: q.limit, total: all.length });
  }

  async setNote(clubId: string, userId: string, note: string, actor: Actor) {
    const booked = await this.prisma.bookings.findFirst({ where: { club_id: clubId, customer_id: userId } });
    if (!booked) throw new AppException('NOT_FOUND', 'Customer not found');
    const n = await this.prisma.customer_notes.upsert({
      where: { club_id_user_id: { club_id: clubId, user_id: userId } },
      update: { note, updated_by: actor.id },
      create: { id: uuidv7(), club_id: clubId, user_id: userId, note, updated_by: actor.id },
    });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'customer.note.set', target_type: 'user', target_id: userId });
    return n;
  }
}
