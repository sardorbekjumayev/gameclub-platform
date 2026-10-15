import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { PageQuery, pageArgs } from '../../common/dto/pagination.dto';
import { DEFAULT_CANCELLATION_POLICY, maskCard, policyFrom } from '../../common/domain/price-engine';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { slugify } from '../../common/utils/codes';
import { uuidv7 } from '../../common/utils/id';
import { FilesService } from '../files/files.service';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCan, clubScopeWhere, scopeFilter } from '../rbac/access';
import { Grant, RbacService } from '../rbac/rbac.service';
import { AdminCreateClubDto, ClubDocumentDto, ClubListQuery, ClubSettingsDto, CreateClubDto, ReviewDocumentDto, UpdateClubDto } from './dto/clubs.dto';

export interface Actor {
  id: string;
  ip?: string | null;
  ua?: string | null;
  request_id?: string | null;
}

/** Ruxsat etilgan status o'tishlari (docs/01-API.md §6.2). */
const TRANSITIONS: Record<string, string[]> = {
  approve: ['PENDING_APPROVAL'],
  reject: ['PENDING_APPROVAL'],
  suspend: ['ACTIVE'],
  reactivate: ['SUSPENDED'],
  close: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED'],
};
const TARGET: Record<string, string> = { approve: 'ACTIVE', reject: 'REJECTED', suspend: 'SUSPENDED', reactivate: 'ACTIVE', close: 'CLOSED' };

export const PUBLIC_CLUB_SELECT = {
  id: true, name: true, slug: true, logo_url: true, cover_url: true, description: true, phone: true, telegram: true,
  instagram: true, website: true, rules: true, amenities: true, rating_avg: true, rating_count: true, status: true,
} satisfies Prisma.clubsSelect;

@Injectable()
export class ClubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
    private readonly plans: PlansService,
    private readonly files: FilesService,
  ) {}

  private async uniqueSlug(name: string, db: Prisma.TransactionClient = this.prisma) {
    const base = slugify(name);
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      if (!(await db.clubs.findUnique({ where: { slug } }))) return slug;
    }
    return `${base}-${uuidv7().slice(-8)}`;
  }

  async listPublic(q: PageQuery) {
    const where: Prisma.clubsWhereInput = {
      status: 'ACTIVE',
      deleted_at: null,
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.clubs.findMany({ where, orderBy: [{ rating_avg: 'desc' }, { name: 'asc' }], ...pageArgs(q), select: { ...PUBLIC_CLUB_SELECT, _count: { select: { branches: { where: { status: 'ACTIVE', deleted_at: null } } } } } }),
      this.prisma.clubs.count({ where }),
    ]);
    return new Paginated(rows, { page: q.page, limit: q.limit, total });
  }

  async getPublic(idOrSlug: string) {
    const isId = /^[0-9a-f-]{36}$/.test(idOrSlug);
    const club = await this.prisma.clubs.findFirst({
      where: { ...(isId ? { id: idOrSlug } : { slug: idOrSlug }), status: 'ACTIVE', deleted_at: null },
      select: {
        ...PUBLIC_CLUB_SELECT,
        branches: {
          where: { status: 'ACTIVE', deleted_at: null },
          select: { id: true, name: true, slug: true, address: true, latitude: true, longitude: true, cover_url: true, rating_avg: true, rating_count: true },
        },
      },
    });
    if (!club) throw new AppException('NOT_FOUND', 'Club not found');
    return club;
  }

  /** Admin panel uchun: foydalanuvchi a'zo bo'lgan klublar (klub almashtirgich). */
  async mine(userId: string) {
    const grants = await this.rbac.grants(userId);
    const platform = grants.some((g) => g.scope_type === 'PLATFORM' && g.permissions.includes('clubs.view'));
    const clubIds = [...new Set(grants.filter((g) => g.club_id).map((g) => g.club_id!))];
    const clubs = await this.prisma.clubs.findMany({
      where: { deleted_at: null, ...(platform ? {} : { id: { in: clubIds } }) },
      orderBy: { created_at: 'desc' },
      take: platform ? 200 : undefined,
      select: {
        id: true, name: true, slug: true, status: true, logo_url: true, rejection_reason: true, suspended_reason: true,
        branches: { where: { deleted_at: null }, select: { id: true, name: true, status: true }, orderBy: { created_at: 'asc' } },
      },
    });
    return clubs.map((c) => {
      const mine = grants.filter((g) => g.club_id === c.id);
      const branchScoped = mine.length > 0 && mine.every((g) => g.scope_type === 'BRANCH');
      return {
        ...c,
        my_roles: mine.map((g) => ({ role: g.role, branch_id: g.branch_id })),
        // Filial rolidagi xodim faqat o'z filiallarini ko'radi
        branches: branchScoped ? c.branches.filter((b) => mine.some((g) => g.branch_id === b.id)) : c.branches,
      };
    });
  }

  async get(clubId: string, grants: Grant[]) {
    assertCan(grants, 'clubs.view', { club_id: clubId });
    const club = await this.prisma.clubs.findFirst({ where: { id: clubId, deleted_at: null }, include: { documents: true } });
    if (!club) throw new AppException('NOT_FOUND', 'Club not found');
    const sub = await this.prisma.subscriptions.findFirst({ where: { club_id: clubId }, orderBy: { created_at: 'desc' }, include: { plan: true } });
    const counts = {
      branches: await this.prisma.branches.count({ where: { club_id: clubId, deleted_at: null } }),
      devices: await this.prisma.devices.count({ where: { club_id: clubId, deleted_at: null } }),
      staff: await this.prisma.user_roles.count({ where: { club_id: clubId } }),
    };
    // Karta faqat settings.view orqali (GET /clubs/:id/settings)
    const { transfer_card_number, transfer_card_holder, transfer_link_url, transfer_link_label, ...rest } = club;
    void transfer_card_holder;
    void transfer_link_label;
    return { ...rest, documents: this.files.withDocUrls(rest.documents), has_transfer_card: !!transfer_card_number, has_transfer_link: !!transfer_link_url, subscription: sub, counts, cancellation_policy: policyFrom(club.cancellation_policy) };
  }

  /**
   * Tranzaksiya ichida faqat `tx` ishlatiladi: `this.prisma` ikkinchi ulanish so'raydi va
   * parallel yaratishda connection pool tugab qotib qoladi. Sinov sozlamalari (`trial`) tranzaksiyadan oldin o'qiladi.
   */
  private async createClubRecord(tx: Prisma.TransactionClient, ownerId: string, dto: CreateClubDto, status: string, actorId: string, trial: { plan_id: string | null; days: number }) {
    const club = await tx.clubs.create({
      data: {
        id: uuidv7(),
        owner_id: ownerId,
        name: dto.name,
        slug: await this.uniqueSlug(dto.name, tx),
        description: dto.description,
        phone: dto.phone,
        telegram: dto.telegram,
        instagram: dto.instagram,
        website: dto.website,
        logo_url: dto.logo_url,
        cover_url: dto.cover_url,
        rules: dto.rules,
        amenities: dto.amenities ?? [],
        min_booking_minutes: dto.min_booking_minutes ?? 60,
        cancellation_policy: DEFAULT_CANCELLATION_POLICY as unknown as Prisma.InputJsonValue,
        status,
        ...(status === 'ACTIVE' ? { approved_at: new Date(), approved_by: actorId } : {}),
      },
    });
    const owner = await tx.roles.findUniqueOrThrow({ where: { code: 'CLUB_OWNER' } });
    await tx.user_roles.create({ data: { id: uuidv7(), user_id: ownerId, role_id: owner.id, club_id: club.id, granted_by: actorId } });
    // Yangi klub: super admin sozlagan sinov rejasi va muddati (docs/01-API.md §6.18)
    const plan = trial.plan_id && trial.days > 0 ? { id: trial.plan_id } : null;
    if (plan) {
      const now = new Date();
      const end = new Date(now.getTime() + trial.days * 86400_000);
      await tx.subscriptions.create({ data: { id: uuidv7(), club_id: club.id, plan_id: plan.id, status: 'TRIALING', current_period_start: now, current_period_end: end, trial_ends_at: end } });
    }
    return club;
  }

  /** Platforma xodimlari (SUPER_ADMIN/SUPPORT) klub ochmaydi va klub egasi bo'lolmaydi — ular faqat boshqaradi. */
  private async assertNotPlatformStaff(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    // CUSTOMER ham PLATFORM scope'li — shuning uchun rol kodi bo'yicha tekshiriladi
    const n = await tx.user_roles.count({ where: { user_id: userId, role: { code: { in: ['SUPER_ADMIN', 'SUPPORT'] } } } });
    if (n > 0) throw new AppException('FORBIDDEN', 'Platform staff cannot own a club', { reason: 'PLATFORM_STAFF_CANNOT_OWN_CLUB' });
  }

  /** Istalgan foydalanuvchi klub arizasini yaratadi (DRAFT) va CLUB_OWNER bo'ladi. */
  async create(userId: string, dto: CreateClubDto, actor: Actor) {
    await this.assertNotPlatformStaff(userId);
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: userId } });
    if (!user.password_hash && !dto.owner_password) {
      throw new AppException('VALIDATION_ERROR', 'owner_password is required to access the admin panel', { field: 'owner_password' });
    }
    const trial = await this.plans.trialSettings();
    const club = await this.prisma.$transaction(async (tx) => {
      if (dto.owner_password) await tx.users.update({ where: { id: userId }, data: { password_hash: await argon2.hash(dto.owner_password, { type: argon2.argon2id }) } });
      const c = await this.createClubRecord(tx, userId, dto, 'DRAFT', userId, trial);
      await this.audit.log({ actor_id: userId, club_id: c.id, action: 'club.create', target_type: 'club', target_id: c.id, new_value: { name: c.name }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
      return c;
    });
    await this.rbac.invalidate(userId);
    return club;
  }

  /** Super admin: egasi telefon bo'yicha (yo'q bo'lsa yaratiladi) klub ochadi. */
  async adminCreate(dto: AdminCreateClubDto, actor: Actor) {
    const { owner_phone, owner_first_name, owner_last_name, activate, ...clubDto } = dto;
    const trial = await this.plans.trialSettings();
    const club = await this.prisma.$transaction(async (tx) => {
      let owner = await tx.users.findUnique({ where: { phone: owner_phone } });
      if (owner) await this.assertNotPlatformStaff(owner.id, tx);
      if (!owner) {
        if (!dto.owner_password) throw new AppException('VALIDATION_ERROR', 'owner_password is required for a new owner', { field: 'owner_password' });
        owner = await tx.users.create({
          data: { id: uuidv7(), type: 'STAFF', phone: owner_phone, first_name: owner_first_name, last_name: owner_last_name, status: 'ACTIVE' },
        });
      }
      if (dto.owner_password) await tx.users.update({ where: { id: owner.id }, data: { password_hash: await argon2.hash(dto.owner_password, { type: argon2.argon2id }) } });
      const c = await this.createClubRecord(tx, owner.id, clubDto, activate === false ? 'DRAFT' : 'ACTIVE', actor.id, trial); // super admin qo'shgani moderatsiyasiz faol
      await this.audit.log({ actor_id: actor.id, club_id: c.id, action: 'admin.club.create', target_type: 'club', target_id: c.id, new_value: { name: c.name, owner_phone }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
      return { club: c, owner_id: owner.id };
    });
    await this.rbac.invalidate(club.owner_id);
    return club.club;
  }

  async update(clubId: string, dto: UpdateClubDto, grants: Grant[], actor: Actor) {
    assertCan(grants, 'clubs.update', { club_id: clubId });
    const old = await this.prisma.clubs.findFirst({ where: { id: clubId, deleted_at: null } });
    if (!old) throw new AppException('NOT_FOUND', 'Club not found');
    const club = await this.prisma.clubs.update({ where: { id: clubId }, data: dto });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'club.update', target_type: 'club', target_id: clubId, old_value: pick(old, Object.keys(dto)), new_value: dto, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return club;
  }

  async submit(clubId: string, grants: Grant[], actor: Actor) {
    assertCan(grants, 'clubs.update', { club_id: clubId });
    const club = await this.prisma.clubs.findFirst({ where: { id: clubId, deleted_at: null } });
    if (!club) throw new AppException('NOT_FOUND', 'Club not found');
    if (!['DRAFT', 'REJECTED'].includes(club.status)) throw new AppException('CONFLICT', `Cannot submit from ${club.status}`);
    const branches = await this.prisma.branches.count({ where: { club_id: clubId, deleted_at: null } });
    const missing = [...(branches === 0 ? ['branch'] : []), ...(!club.phone ? ['phone'] : [])];
    if (missing.length) throw new AppException('VALIDATION_ERROR', 'Club profile is incomplete', { missing });
    const updated = await this.prisma.clubs.update({ where: { id: clubId }, data: { status: 'PENDING_APPROVAL', rejection_reason: null } });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'club.submit', target_type: 'club', target_id: clubId, old_value: { status: club.status }, new_value: { status: 'PENDING_APPROVAL' }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return updated;
  }

  async settings(clubId: string, grants: Grant[]) {
    assertCan(grants, 'settings.view', { club_id: clubId });
    const c = await this.prisma.clubs.findFirstOrThrow({
      where: { id: clubId },
      select: { cancellation_policy: true, settings: true, transfer_card_number: true, transfer_card_holder: true, transfer_link_url: true, transfer_link_label: true, transfer_receipt_required: true },
    });
    return {
      cancellation_policy: policyFrom(c.cancellation_policy),
      settings: c.settings ?? {},
      transfer_card: c.transfer_card_number ? { number: c.transfer_card_number, holder: c.transfer_card_holder } : null,
      transfer_link: c.transfer_link_url ? { url: c.transfer_link_url, label: c.transfer_link_label } : null,
      transfer_receipt_required: c.transfer_receipt_required,
    };
  }

  async updateSettings(clubId: string, dto: ClubSettingsDto, grants: Grant[], actor: Actor) {
    assertCan(grants, 'settings.update', { club_id: clubId });
    if (dto.cancellation_policy) {
      const mins = dto.cancellation_policy.rules.map((r) => r.min_minutes_before_start);
      if (!mins.length || mins.length > 8 || new Set(mins).size !== mins.length) {
        throw new AppException('VALIDATION_ERROR', 'Rules must be 1..8 items with distinct min_minutes_before_start', { field: 'cancellation_policy.rules' });
      }
    }
    const old = await this.settings(clubId, grants.length ? grants : []);
    const card = dto.transfer_card;
    const link = dto.transfer_link;
    await this.prisma.clubs.update({
      where: { id: clubId },
      data: {
        ...(dto.cancellation_policy ? { cancellation_policy: dto.cancellation_policy as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.settings ? { settings: dto.settings as Prisma.InputJsonValue } : {}),
        ...(card === null ? { transfer_card_number: null, transfer_card_holder: null } : {}),
        ...(card ? { transfer_card_number: card.number, transfer_card_holder: card.holder.trim().toUpperCase() } : {}),
        ...(link === null ? { transfer_link_url: null, transfer_link_label: null } : {}),
        ...(link ? { transfer_link_url: link.url.trim(), transfer_link_label: link.label?.trim() || null } : {}),
        ...(dto.transfer_receipt_required !== undefined ? { transfer_receipt_required: dto.transfer_receipt_required } : {}),
      },
    });
    // Karta raqami audit log'ga faqat maskalangan holda tushadi
    const masked = <T extends { transfer_card?: { number: string } | null }>(v: T) => (v.transfer_card ? { ...v, transfer_card: { ...v.transfer_card, number: maskCard(v.transfer_card.number) } } : v);
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'club.settings.update', target_type: 'club', target_id: clubId, old_value: masked(old), new_value: masked(dto), ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id });
    return this.settings(clubId, grants);
  }

  async addDocument(clubId: string, dto: ClubDocumentDto, grants: Grant[], actor: Actor) {
    assertCan(grants, 'clubs.documents.manage', { club_id: clubId });
    if (!!dto.file_url === !!dto.file_id) throw new AppException('VALIDATION_ERROR', 'Exactly one of file_url or file_id is required', { field: 'file_id' });
    const doc = await this.prisma.$transaction(async (tx) => {
      const id = uuidv7();
      if (dto.file_id) await this.files.claimClubDocument(tx, dto.file_id, clubId, id);
      return tx.club_documents.create({ data: { id, club_id: clubId, type: dto.type, file_url: dto.file_url ?? null, file_id: dto.file_id ?? null } });
    });
    await this.audit.log({ actor_id: actor.id, club_id: clubId, action: 'club.document.add', target_type: 'club_document', target_id: doc.id, new_value: dto });
    return this.files.withDocUrls([doc])[0];
  }

  async documents(clubId: string, grants: Grant[]) {
    assertCan(grants, 'clubs.documents.manage', { club_id: clubId });
    return this.files.withDocUrls(await this.prisma.club_documents.findMany({ where: { club_id: clubId }, orderBy: { created_at: 'desc' } }));
  }

  // ---------- Super admin ----------

  async adminList(q: ClubListQuery) {
    const where: Prisma.clubsWhereInput = {
      deleted_at: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q } }, { phone: { contains: q.q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.clubs.findMany({
        where,
        orderBy: { created_at: 'desc' },
        ...pageArgs(q),
        include: { _count: { select: { branches: { where: { deleted_at: null } }, documents: true } } },
      }),
      this.prisma.clubs.count({ where }),
    ]);
    const owners = await this.prisma.users.findMany({ where: { id: { in: rows.map((r) => r.owner_id) } }, select: { id: true, phone: true, email: true, first_name: true, last_name: true } });
    const byId = new Map(owners.map((o) => [o.id, o]));
    return new Paginated(rows.map((r) => ({ ...r, owner: byId.get(r.owner_id) ?? null })), { page: q.page, limit: q.limit, total });
  }

  async adminGet(clubId: string) {
    const club = await this.prisma.clubs.findFirst({
      where: { id: clubId },
      include: { documents: true, branches: { where: { deleted_at: null } }, subscriptions: { include: { plan: true }, orderBy: { created_at: 'desc' }, take: 1 } },
    });
    if (!club) throw new AppException('NOT_FOUND', 'Club not found');
    const owner = await this.prisma.users.findUnique({ where: { id: club.owner_id }, select: { id: true, phone: true, email: true, first_name: true, last_name: true } });
    const stats = await this.prisma.bookings.aggregate({ where: { club_id: clubId, status: { in: ['CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'COMPLETED'] } }, _count: true, _sum: { total_amount: true } });
    return { ...club, documents: this.files.withDocUrls(club.documents), owner, stats: { bookings: stats._count, gmv: stats._sum.total_amount ?? 0n } };
  }

  async transition(clubId: string, action: keyof typeof TRANSITIONS, reason: string | undefined, actor: Actor) {
    const club = await this.prisma.clubs.findFirst({ where: { id: clubId, deleted_at: null } });
    if (!club) throw new AppException('NOT_FOUND', 'Club not found');
    if (!TRANSITIONS[action].includes(club.status)) throw new AppException('CONFLICT', `Cannot ${action} club in status ${club.status}`);
    if (['reject', 'suspend', 'close'].includes(action) && !reason) throw new AppException('VALIDATION_ERROR', 'reason is required', { field: 'reason' });
    const status = TARGET[action];
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.clubs.update({
        where: { id: clubId },
        data: {
          status,
          ...(action === 'approve' ? { approved_by: actor.id, approved_at: new Date(), rejection_reason: null } : {}),
          ...(action === 'reject' ? { rejection_reason: reason } : {}),
          ...(action === 'suspend' ? { suspended_reason: reason } : {}),
          ...(action === 'reactivate' ? { suspended_reason: null } : {}),
        },
      });
      await this.audit.log({ actor_id: actor.id, club_id: clubId, action: `admin.club.${action}`, target_type: 'club', target_id: clubId, old_value: { status: club.status }, new_value: { status, reason }, ip: actor.ip, user_agent: actor.ua, request_id: actor.request_id }, tx);
      return u;
    });
    const type = { approve: 'CLUB_APPROVED', reject: 'CLUB_REJECTED', suspend: 'CLUB_SUSPENDED' }[action as string];
    if (type) await this.notifications.notify([club.owner_id], type, { club: club.name, reason: reason ?? '' }, { club_id: clubId });
    return updated;
  }

  async reviewDocument(docId: string, dto: ReviewDocumentDto, actor: Actor) {
    const doc = await this.prisma.club_documents.update({ where: { id: docId }, data: { status: dto.status, note: dto.note, reviewed_by: actor.id } });
    await this.audit.log({ actor_id: actor.id, club_id: doc.club_id, action: 'admin.club.document.review', target_type: 'club_document', target_id: docId, new_value: dto });
    return doc;
  }

  /** Ro'yxatlarni tenant bo'yicha filtrlash uchun (boshqa servislar ishlatadi). */
  clubWhere(grants: Grant[], permission: Parameters<typeof scopeFilter>[1]) {
    return clubScopeWhere(scopeFilter(grants, permission), grants);
  }
}

function pick(o: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}
