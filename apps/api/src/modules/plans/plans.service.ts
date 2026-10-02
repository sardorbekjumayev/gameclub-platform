import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageArgs } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../clubs/clubs.service';
import { SettingsService } from '../settings/settings.service';
import { AssignPlanDto, CreatePlanDto, SubscriptionListQuery, TrialSettingsDto, UpdatePlanDto } from './plans.dto';

const LIVE_SUB = ['TRIALING', 'ACTIVE', 'PAST_DUE'];
export const TRIAL_PLAN_KEY = 'subscription.trial_plan_id';
export const TRIAL_DAYS_KEY = 'subscription.trial_days';

/** Tarif rejalari va obunalar (docs/01-API.md §6.18) — super admin boshqaradi. */
@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private log(actor: Actor, action: string, targetId: string, extra: { club_id?: string; old_value?: unknown; new_value?: unknown } = {}) {
    return this.audit.log({ actor_id: actor.id, action, target_type: action.startsWith('admin.subscription') ? 'subscription' : 'plan', target_id: targetId, ...extra, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
  }

  /** Ommaviy: faol rejalar (narx bo'yicha). */
  publicList() {
    return this.prisma.plans.findMany({ where: { is_active: true }, orderBy: { price_per_month: 'asc' }, select: { id: true, code: true, name: true, price_per_month: true, limits: true } });
  }

  async adminList() {
    const [plans, counts, trial] = await Promise.all([
      this.prisma.plans.findMany({ orderBy: [{ is_active: 'desc' }, { price_per_month: 'asc' }] }),
      this.prisma.subscriptions.groupBy({ by: ['plan_id'], where: { status: { in: LIVE_SUB } }, _count: true }),
      this.trialSettings(),
    ]);
    const byPlan = new Map(counts.map((c) => [c.plan_id, c._count]));
    return plans.map((p) => ({ ...p, active_clubs: byPlan.get(p.id) ?? 0, is_trial_plan: p.id === trial.plan_id }));
  }

  async create(dto: CreatePlanDto, actor: Actor) {
    if (await this.prisma.plans.findUnique({ where: { code: dto.code } })) throw new AppException('CONFLICT', 'Plan code already exists', { field: 'code' });
    const plan = await this.prisma.plans.create({
      data: { id: uuidv7(), code: dto.code, name: dto.name, price_per_month: BigInt(dto.price_per_month), limits: dto.limits as unknown as Prisma.InputJsonValue, is_active: dto.is_active ?? true },
    });
    await this.log(actor, 'admin.plan.create', plan.id, { new_value: dto });
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto, actor: Actor) {
    const old = await this.prisma.plans.findUnique({ where: { id } });
    if (!old) throw new AppException('NOT_FOUND', 'Plan not found');
    if (dto.is_active === false && (await this.trialSettings()).plan_id === id) throw new AppException('CONFLICT', 'This plan is used as the trial plan', { reason: 'TRIAL_PLAN' });
    const plan = await this.prisma.plans.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.price_per_month !== undefined && { price_per_month: BigInt(dto.price_per_month) }),
        ...(dto.limits !== undefined && { limits: dto.limits as unknown as Prisma.InputJsonValue }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });
    await this.log(actor, 'admin.plan.update', id, { old_value: { name: old.name, price_per_month: Number(old.price_per_month), limits: old.limits, is_active: old.is_active }, new_value: dto });
    return plan;
  }

  /** Obunasi bor rejani o'chirib bo'lmaydi — faqat nofaol qilinadi (tarix saqlanadi). */
  async remove(id: string, actor: Actor) {
    const plan = await this.prisma.plans.findUnique({ where: { id } });
    if (!plan) throw new AppException('NOT_FOUND', 'Plan not found');
    const used = await this.prisma.subscriptions.count({ where: { plan_id: id } });
    if (used) throw new AppException('CONFLICT', 'Plan has subscriptions; deactivate it instead', { reason: 'PLAN_IN_USE', subscriptions: used });
    if ((await this.trialSettings()).plan_id === id) throw new AppException('CONFLICT', 'This plan is used as the trial plan', { reason: 'TRIAL_PLAN' });
    await this.prisma.plans.delete({ where: { id } });
    await this.log(actor, 'admin.plan.delete', id, { old_value: { code: plan.code } });
    return { deleted: true };
  }

  /** Yangi klubga beriladigan sinov rejasi. Sozlanmagan bo'lsa — PRO (bo'lmasa eng arzon faol reja). */
  async trialSettings() {
    const [planId, days] = await Promise.all([this.settings.get<string | undefined>(TRIAL_PLAN_KEY), this.settings.get<number | undefined>(TRIAL_DAYS_KEY)]);
    let plan = planId ? await this.prisma.plans.findFirst({ where: { id: planId, is_active: true } }) : null;
    plan ??= await this.prisma.plans.findFirst({ where: { code: 'PRO', is_active: true } });
    plan ??= await this.prisma.plans.findFirst({ where: { is_active: true }, orderBy: { price_per_month: 'asc' } });
    return { plan_id: plan?.id ?? null, plan_code: plan?.code ?? null, days: typeof days === 'number' ? days : 30 };
  }

  async setTrialSettings(dto: TrialSettingsDto, actor: Actor) {
    const plan = await this.prisma.plans.findFirst({ where: { id: dto.plan_id, is_active: true } });
    if (!plan) throw new AppException('NOT_FOUND', 'Active plan not found');
    await this.settings.set(TRIAL_PLAN_KEY, plan.id, actor.id);
    await this.settings.set(TRIAL_DAYS_KEY, dto.days, actor.id);
    await this.log(actor, 'admin.plan.trial', plan.id, { new_value: dto });
    return this.trialSettings();
  }

  async subscriptions(q: SubscriptionListQuery) {
    const where: Prisma.subscriptionsWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.plan_id && { plan_id: q.plan_id }),
      ...(q.q && { club: { name: { contains: q.q, mode: 'insensitive' } } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.subscriptions.findMany({ where, orderBy: { created_at: 'desc' }, ...pageArgs(q), include: { plan: { select: { id: true, code: true, name: true } }, club: { select: { id: true, name: true, status: true } } } }),
      this.prisma.subscriptions.count({ where }),
    ]);
    return new Paginated(rows, { page: q.page, limit: q.limit, total });
  }

  /** Klubning joriy obunasi + limitlardan foydalanish (egasi va super admin uchun). */
  async clubSubscription(clubId: string) {
    const sub = await this.prisma.subscriptions.findFirst({ where: { club_id: clubId, status: { in: LIVE_SUB } }, orderBy: { created_at: 'desc' }, include: { plan: true } });
    const [branches, devices, staff] = await Promise.all([
      this.prisma.branches.count({ where: { club_id: clubId, deleted_at: null } }),
      this.prisma.devices.count({ where: { club_id: clubId, deleted_at: null } }),
      this.prisma.user_roles.count({ where: { club_id: clubId, role: { code: { not: 'CLUB_OWNER' } } } }),
    ]);
    return { subscription: sub, usage: { branches, devices, staff } };
  }

  /** Super admin klubga reja biriktiradi: joriy obuna CANCELLED, yangisi yaratiladi (tarix saqlanadi). */
  async assign(clubId: string, dto: AssignPlanDto, actor: Actor) {
    const club = await this.prisma.clubs.findFirst({ where: { id: clubId, deleted_at: null } });
    if (!club) throw new AppException('NOT_FOUND', 'Club not found');
    const plan = await this.prisma.plans.findUnique({ where: { id: dto.plan_id } });
    if (!plan) throw new AppException('NOT_FOUND', 'Plan not found');
    const now = new Date();
    const end = new Date(now.getTime() + dto.days * 86400_000);
    const sub = await this.prisma.$transaction(async (tx) => {
      const prev = await tx.subscriptions.findMany({ where: { club_id: clubId, status: { in: LIVE_SUB } }, include: { plan: { select: { code: true } } } });
      await tx.subscriptions.updateMany({ where: { club_id: clubId, status: { in: LIVE_SUB } }, data: { status: 'CANCELLED', cancel_at: now } });
      const created = await tx.subscriptions.create({
        data: { id: uuidv7(), club_id: clubId, plan_id: plan.id, status: dto.status, current_period_start: now, current_period_end: end, trial_ends_at: dto.status === 'TRIALING' ? end : null },
      });
      await this.audit.log(
        { actor_id: actor.id, club_id: clubId, action: 'admin.subscription.assign', target_type: 'subscription', target_id: created.id, old_value: prev.map((p) => ({ plan: p.plan.code, status: p.status })), new_value: { plan: plan.code, status: dto.status, days: dto.days }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id },
        tx,
      );
      return created;
    });
    return { ...sub, plan };
  }
}
