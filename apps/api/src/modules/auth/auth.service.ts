import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import { AppException } from '../../common/errors';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { assertStrongPassword, hashPassword } from './password';
import { ClientInfo, TokenService } from './token.service';

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_S = 600;

type ReqMeta = ClientInfo & { user_agent: string | null; request_id: string | null };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** OTP tasdiqlangandan keyin: mavjud bo'lsa login, bo'lmasa CUSTOMER yaratish. */
  async loginWithPhone(phone: string, meta: ReqMeta) {
    let user = await this.prisma.users.findUnique({ where: { phone } });
    let isNew = false;
    if (!user) {
      const role = await this.prisma.roles.findUniqueOrThrow({ where: { code: 'CUSTOMER' } });
      user = await this.prisma.users.create({
        data: { id: uuidv7(), type: 'CUSTOMER', phone, phone_verified_at: new Date() },
      });
      await this.prisma.user_roles.create({ data: { id: uuidv7(), user_id: user.id, role_id: role.id } });
      isNew = true;
    } else if (!user.phone_verified_at) {
      user = await this.prisma.users.update({ where: { id: user.id }, data: { phone_verified_at: new Date() } });
    }
    this.assertActive(user);
    return this.finishLogin(user, meta, isNew);
  }

  async loginWithPassword(login: string, password: string, meta: ReqMeta) {
    const normalized = login.trim().toLowerCase();
    const limiterKey = `login:${meta.ip}:${normalized}`;
    const attempts = await this.redis.incr(limiterKey);
    if (attempts === 1) await this.redis.expire(limiterKey, LOGIN_WINDOW_S);
    if (attempts > LOGIN_LIMIT) throw new AppException('RATE_LIMITED', 'Too many login attempts');

    const user = await this.prisma.users.findFirst({
      where: normalized.includes('@') ? { email: normalized } : { phone: normalized },
    });
    const valid = !!user?.password_hash && (await argon2.verify(user.password_hash, password));
    if (!user || !valid) {
      await this.audit.log({
        actor_id: user?.id ?? null, action: 'auth.login_failed', target_type: 'user', target_id: user?.id ?? null,
        ip: meta.ip, user_agent: meta.user_agent, request_id: meta.request_id,
      });
      throw new AppException('UNAUTHORIZED', 'Invalid credentials');
    }
    this.assertActive(user);
    await this.redis.del(limiterKey);
    return this.finishLogin(user, meta, false);
  }

  async setPassword(userId: string, password: string) {
    assertStrongPassword(password);
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: userId }, select: { password_hash: true, must_change_password: true } });
    // Admin tiklagan vaqtinchalik parolni o'zini qayta o'rnatib bo'lmaydi
    if (user.must_change_password && user.password_hash && (await argon2.verify(user.password_hash, password))) {
      throw new AppException('VALIDATION_ERROR', 'New password must differ from the temporary one', { field: 'password', reason: 'SAME_AS_TEMPORARY' });
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: await hashPassword(password), must_change_password: false },
    });
    if (user.must_change_password) await this.audit.log({ actor_id: userId, action: 'auth.password_changed_after_reset', target_type: 'user', target_id: userId });
  }

  private assertActive(user: { status: string; deleted_at: Date | null }) {
    if (user.status === 'BLOCKED' || user.deleted_at) throw new AppException('FORBIDDEN', 'Account disabled');
  }

  /** Taklif qabul qilingandan keyin sessiya ochish. */
  async loginById(userId: string, meta: ReqMeta) {
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: userId } });
    this.assertActive(user);
    return this.finishLogin(user, meta, false);
  }

  private async finishLogin(user: { id: string; type: string }, meta: ReqMeta, isNew: boolean) {
    await this.prisma.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } });
    const pair = await this.tokens.issuePair(user, meta);
    const me = await this.me(user.id);
    return { ...pair, is_new: isNew, must_change_password: me.must_change_password, user: me };
  }

  async me(userId: string) {
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true, type: true, phone: true, email: true, first_name: true, last_name: true,
        language: true, status: true, avatar_file_id: true, totp_enabled: true, created_at: true, password_hash: true,
        must_change_password: true,
      },
    });
    const { password_hash, ...safe } = user;
    const grants = await this.rbac.grants(userId);
    return {
      ...safe,
      has_password: !!password_hash,
      roles: grants.map(({ role, scope_type, club_id, branch_id }) => ({ role, scope_type, club_id, branch_id })),
      permissions: [...new Set(grants.flatMap((g) => g.permissions))].sort(),
    };
  }
}
