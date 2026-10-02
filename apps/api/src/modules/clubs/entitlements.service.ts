import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';

export type LimitKey = 'branches' | 'devices' | 'staff';

/** EntitlementsGuard (docs/01-API.md §6.18): plan limitlari. `null` = cheksiz. */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async current(clubId: string) {
    return this.prisma.subscriptions.findFirst({
      where: { club_id: clubId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      orderBy: { created_at: 'desc' },
      include: { plan: true },
    });
  }

  async assertWithin(clubId: string, key: LimitKey) {
    const sub = await this.current(clubId);
    const limit = (sub?.plan.limits as Record<string, number | null> | undefined)?.[key];
    if (limit === null || limit === undefined) return;
    const used =
      key === 'branches'
        ? await this.prisma.branches.count({ where: { club_id: clubId, deleted_at: null } })
        : key === 'devices'
          ? await this.prisma.devices.count({ where: { club_id: clubId, deleted_at: null } })
          : await this.prisma.user_roles.count({ where: { club_id: clubId, role: { code: { not: 'CLUB_OWNER' } } } });
    if (used >= limit) throw new AppException('PLAN_LIMIT_REACHED', `Plan limit reached: ${key}`, { key, limit, used });
  }

  async canAcceptBookings(clubId: string) {
    const sub = await this.current(clubId);
    return !!sub && sub.current_period_end.getTime() + 7 * 86400_000 > Date.now();
  }
}
