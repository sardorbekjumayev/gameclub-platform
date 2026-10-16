import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageArgs } from '../../common/dto/pagination.dto';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type Actor } from '../clubs/clubs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClubApplicationListQuery, CreateClubApplicationDto, UpdateClubApplicationDto } from './club-applications.dto';

/** Shu telefondan ochiq ariza shu oyna ichida bo'lsa — yangisi ochilmaydi (takroriy bosish/spam), mavjudi qaytariladi. */
const DEDUPE_WINDOW_MS = 24 * 3600 * 1000;
const OPEN = ['NEW', 'CONTACTED'];

@Injectable()
export class ClubApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateClubApplicationDto) {
    const data = {
      full_name: dto.full_name,
      phone: dto.phone,
      club_name: dto.club_name,
      city: dto.city,
      address: dto.address ?? null,
      devices_count: dto.devices_count ?? null,
      branches_count: dto.branches_count ?? null,
      telegram: dto.telegram ?? null,
      comment: dto.comment ?? null,
      language: dto.language ?? 'uz',
    };
    const recent = await this.prisma.club_applications.findFirst({
      where: { phone: dto.phone, status: { in: OPEN }, created_at: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
      orderBy: { created_at: 'desc' },
    });
    if (recent) return { id: recent.id, status: recent.status };
    const app = await this.prisma.club_applications.create({ data: { id: uuidv7(), ...data } });
    // Faqat super adminlar (arizani ko'rib chiqish huquqi — platform.clubs.approve)
    const admins = await this.prisma.user_roles.findMany({ where: { role: { code: 'SUPER_ADMIN' } }, select: { user_id: true } });
    await this.notifications.notify(
      admins.map((r) => r.user_id),
      'CLUB_APPLICATION_NEW',
      { club: app.club_name, city: app.city, name: app.full_name, phone: app.phone },
      { club_application_id: app.id },
    );
    return { id: app.id, status: app.status };
  }

  async list(q: ClubApplicationListQuery) {
    const search = q.q?.trim();
    const where: Prisma.club_applicationsWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(search
        ? {
            OR: [
              { club_name: { contains: search, mode: 'insensitive' } },
              { full_name: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search.replace(/[\s()-]/g, '') } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.club_applications.findMany({ where, orderBy: { created_at: 'desc' }, ...pageArgs(q) }),
      this.prisma.club_applications.count({ where }),
    ]);
    return new Paginated(rows, { page: q.page, limit: q.limit, total });
  }

  /** Menyu badge'i: ko'rib chiqilmagan arizalar. */
  async stats() {
    const [fresh, open] = await Promise.all([
      this.prisma.club_applications.count({ where: { status: 'NEW' } }),
      this.prisma.club_applications.count({ where: { status: { in: OPEN } } }),
    ]);
    return { new: fresh, open };
  }

  async get(id: string) {
    const a = await this.prisma.club_applications.findUnique({ where: { id } });
    if (!a) throw new AppException('NOT_FOUND', 'Application not found');
    const handler = a.handled_by
      ? await this.prisma.users.findUnique({ where: { id: a.handled_by }, select: { id: true, first_name: true, last_name: true, email: true } })
      : null;
    return { ...a, handler };
  }

  async update(id: string, dto: UpdateClubApplicationDto, actor: Actor) {
    const a = await this.prisma.club_applications.findUnique({ where: { id } });
    if (!a) throw new AppException('NOT_FOUND', 'Application not found');
    const statusChanged = !!dto.status && dto.status !== a.status;
    await this.prisma.$transaction(async (tx) => {
      await tx.club_applications.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.admin_note !== undefined ? { admin_note: dto.admin_note.trim() || null } : {}),
          ...(statusChanged ? { handled_by: actor.id, handled_at: new Date() } : {}),
        },
      });
      await this.audit.log(
        {
          actor_id: actor.id,
          action: 'admin.club_application.update',
          target_type: 'club_application',
          target_id: id,
          old_value: { status: a.status, admin_note: a.admin_note },
          new_value: { ...dto },
          ip: actor.ip ?? null,
          user_agent: actor.ua ?? null,
        },
        tx,
      );
    });
    return this.get(id);
  }
}
