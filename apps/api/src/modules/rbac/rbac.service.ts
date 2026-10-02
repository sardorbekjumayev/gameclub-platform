import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';

export interface Grant {
  role: string;
  scope_type: 'PLATFORM' | 'CLUB' | 'BRANCH';
  club_id: string | null;
  branch_id: string | null;
  permissions: string[];
}

export interface ResourceScope {
  club_id?: string | null;
  branch_id?: string | null;
}

const CACHE_TTL_S = 60;

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async grants(userId: string): Promise<Grant[]> {
    const key = `rbac:grants:${userId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);

    const rows = await this.prisma.user_roles.findMany({
      where: { user_id: userId, OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
      include: { role: { include: { role_permissions: { include: { permission: true } } } } },
    });
    const grants: Grant[] = rows.map((r) => ({
      role: r.role.code,
      scope_type: r.role.scope_type as Grant['scope_type'],
      club_id: r.club_id,
      branch_id: r.branch_id,
      permissions: r.role.role_permissions.map((rp) => rp.permission.code),
    }));
    await this.redis.set(key, JSON.stringify(grants), 'EX', CACHE_TTL_S);
    return grants;
  }

  async invalidate(userId: string) {
    await this.redis.del(`rbac:grants:${userId}`);
  }

  /**
   * Permission + scope tekshiruvi (docs/01-API.md §5.2):
   * PLATFORM → hamma; CLUB → shu club; BRANCH → shu branch.
   * Resurs scope'i noma'lum bo'lsa (masalan ro'yxat endpointi) — faqat permission borligi tekshiriladi,
   * tenant filtri service ichida qo'llanadi.
   */
  static allows(grants: Grant[], permission: string, scope?: ResourceScope): boolean {
    return grants.some((g) => {
      if (!g.permissions.includes(permission)) return false;
      if (g.scope_type === 'PLATFORM') return true;
      if (!scope || (!scope.club_id && !scope.branch_id)) return true;
      if (g.scope_type === 'CLUB') return !!scope.club_id && scope.club_id === g.club_id;
      if (scope.branch_id) return scope.branch_id === g.branch_id;
      // Klub darajasidagi marshrut (/clubs/:clubId/...): filial roli o'z klubiga kiradi,
      // natijalar service ichida o'z filiallari bilan cheklanadi.
      return !!scope.club_id && scope.club_id === g.club_id;
    });
  }
}
