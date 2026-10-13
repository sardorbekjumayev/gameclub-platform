import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../clubs/clubs.service';
import { CalculatePayoutsDto, MarkPaidDto, PayoutListQuery } from './payouts.dto';

/**
 * Klub payout'lari (§6.18, V1): davr bo'yicha online to'lovlardan klub ulushi.
 * Naqd/terminal klub kassasiga to'g'ridan-to'g'ri tushadi — payout'ga kirmaydi.
 * net = gross − commission − refunds (davrda qaytarilgan online to'lovlar).
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static readonly ONLINE = ['ONLINE_CARD', 'WALLET'];

  async calculate(dto: CalculatePayoutsDto, actor: Actor) {
    const start = new Date(dto.period_start);
    const end = new Date(dto.period_end);
    if (!(start < end)) throw new AppException('VALIDATION_ERROR', 'period_start must be before period_end', { field: 'period_end' });
    if (end > new Date()) throw new AppException('VALIDATION_ERROR', 'Period must be in the past', { field: 'period_end' });

    const paidWhere: Prisma.paymentsWhereInput = { method: { in: PayoutsService.ONLINE }, paid_at: { gte: start, lt: end }, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, ...(dto.club_id ? { club_id: dto.club_id } : {}) };
    const gross = await this.prisma.payments.groupBy({ by: ['club_id'], where: paidWhere, _sum: { amount: true, commission_amount: true } });
    const onlineIds = (await this.prisma.payments.findMany({ where: { method: { in: PayoutsService.ONLINE }, ...(dto.club_id ? { club_id: dto.club_id } : {}) }, select: { id: true } })).map((p) => p.id);
    const refunds = await this.prisma.refunds.groupBy({ by: ['club_id'], where: { payment_id: { in: onlineIds }, status: { in: ['COMPLETED', 'PENDING'] }, created_at: { gte: start, lt: end } }, _sum: { amount: true } });

    const clubIds = [...new Set([...gross.map((g) => g.club_id), ...refunds.map((r) => r.club_id)])];
    const created: string[] = [];
    const skipped: { club_id: string; reason: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const clubId of clubIds) {
        // Klub bo'yicha qulf — parallel hisoblashda bir davrga ikki payout yaratilmasin
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payout:${clubId}`}))`;
        const overlap = await tx.club_payouts.findFirst({ where: { club_id: clubId, status: { not: 'CANCELLED' }, period_start: { lt: end }, period_end: { gt: start } } });
        if (overlap) {
          skipped.push({ club_id: clubId, reason: 'OVERLAPPING_PAYOUT' });
          continue;
        }
        const g = gross.find((x) => x.club_id === clubId);
        const grossAmt = g?._sum.amount ?? 0n;
        const commission = g?._sum.commission_amount ?? 0n;
        const refundAmt = refunds.find((x) => x.club_id === clubId)?._sum.amount ?? 0n;
        const id = uuidv7();
        await tx.club_payouts.create({ data: { id, club_id: clubId, period_start: start, period_end: end, gross_amount: grossAmt, commission_amount: commission, refunds_amount: refundAmt, net_amount: grossAmt - commission - refundAmt } });
        created.push(id);
      }
      await this.audit.log({ actor_id: actor.id, action: 'admin.payouts.calculate', target_type: 'club_payout', target_id: null, new_value: { period_start: dto.period_start, period_end: dto.period_end, club_id: dto.club_id ?? null, created: created.length }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
    });
    return { created: created.length, skipped, items: await this.withClubs(await this.prisma.club_payouts.findMany({ where: { id: { in: created } }, orderBy: { net_amount: 'desc' } })) };
  }

  async list(q: PayoutListQuery, clubId?: string) {
    const where: Prisma.club_payoutsWhereInput = { ...(clubId || q.club_id ? { club_id: clubId ?? q.club_id } : {}), ...(q.status ? { status: q.status } : {}) };
    const [rows, total, sums] = await Promise.all([
      this.prisma.club_payouts.findMany({ where, orderBy: [{ period_end: 'desc' }, { created_at: 'desc' }], skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.club_payouts.count({ where }),
      this.prisma.club_payouts.groupBy({ by: ['status'], where, _sum: { net_amount: true } }),
    ]);
    const sum = (s: string) => Number(sums.find((x) => x.status === s)?._sum.net_amount ?? 0n);
    return new Paginated(await this.withClubs(rows), { page: q.page, limit: q.limit, total, summary: { pending: sum('PENDING'), paid: sum('PAID') } });
  }

  async markPaid(id: string, dto: MarkPaidDto, actor: Actor) {
    const p = await this.prisma.club_payouts.findUnique({ where: { id } });
    if (!p) throw new AppException('NOT_FOUND', 'Payout not found');
    if (p.status !== 'PENDING') throw new AppException('CONFLICT', `Payout is ${p.status}`);
    // Faqat PENDING holatdan — parallel mark-paid/cancel bir-birini bosib ketmasin
    const done = await this.prisma.club_payouts.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'PAID', paid_at: new Date(), reference: dto.reference } });
    if (!done.count) throw new AppException('CONFLICT', 'Payout is already processed');
    const updated = await this.prisma.club_payouts.findUniqueOrThrow({ where: { id } });
    await this.audit.log({ actor_id: actor.id, club_id: p.club_id, action: 'admin.payout.paid', target_type: 'club_payout', target_id: id, new_value: { reference: dto.reference, net_amount: Number(p.net_amount) }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return updated;
  }

  async cancel(id: string, actor: Actor) {
    const p = await this.prisma.club_payouts.findUnique({ where: { id } });
    if (!p) throw new AppException('NOT_FOUND', 'Payout not found');
    if (p.status !== 'PENDING') throw new AppException('CONFLICT', `Payout is ${p.status}`);
    // Faqat PENDING holatdan — parallel mark-paid/cancel bir-birini bosib ketmasin
    const done = await this.prisma.club_payouts.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (!done.count) throw new AppException('CONFLICT', 'Payout is already processed');
    const updated = await this.prisma.club_payouts.findUniqueOrThrow({ where: { id } });
    await this.audit.log({ actor_id: actor.id, club_id: p.club_id, action: 'admin.payout.cancel', target_type: 'club_payout', target_id: id, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return updated;
  }

  private async withClubs<T extends { club_id: string }>(rows: T[]) {
    const clubs = await this.prisma.clubs.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.club_id))] } }, select: { id: true, name: true } });
    const name = new Map(clubs.map((c) => [c.id, c.name]));
    return rows.map((r) => ({ ...r, club_name: name.get(r.club_id) ?? null }));
  }
}
