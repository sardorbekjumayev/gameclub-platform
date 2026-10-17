import { Body, Controller, Delete, Get, HttpCode, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { AuthUser, CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import type { Actor } from '../clubs/clubs.service';
import { UpdateMeDto } from '../auth/dto/auth.dto';
import { DeleteAccountDto } from './account.dto';
import { AccountService } from './account.service';

class ListUsersQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['CUSTOMER', 'STAFF', 'PLATFORM']) type?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly account: AccountService,
  ) {}

  @Get('users/me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Get('users/me/export')
  @ApiOperation({ summary: 'Mening shaxsiy ma\'lumotlarim eksporti (GDPR)' })
  exportMe(@CurrentUser() user: AuthUser) {
    return this.account.exportMe(user.id);
  }

  @Delete('users/me')
  @HttpCode(200)
  @ApiOperation({ summary: 'Akkauntni o\'chirish (anonimlashtirish; moliyaviy yozuvlar saqlanadi)' })
  deleteMe(@Body() dto: DeleteAccountDto, @CurrentUser() user: AuthUser, @CurrentActor() a: Actor) {
    return this.account.deleteMe(user.id, a, dto.reason);
  }

  @Patch('users/me')
  @ApiOperation({ summary: 'Profilni yangilash' })
  async updateMe(@Body() dto: UpdateMeDto, @CurrentUser() user: AuthUser) {
    if (dto.email) {
      const taken = await this.prisma.users.findFirst({ where: { email: dto.email, NOT: { id: user.id } } });
      if (taken) throw new AppException('CONFLICT', 'Email already in use');
    }
    await this.prisma.users.update({ where: { id: user.id }, data: { ...dto, email: dto.email?.toLowerCase() ?? dto.email } });
    return this.auth.me(user.id);
  }

  @Get('admin/users')
  @RequirePermission('platform.users.view')
  @ApiOperation({ summary: 'Super admin: foydalanuvchilar ro\'yxati' })
  async list(@Query() q: ListUsersQuery) {
    const where = {
      deleted_at: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.q
        ? { OR: [{ phone: { contains: q.q } }, { email: { contains: q.q } }, { first_name: { contains: q.q, mode: 'insensitive' as const } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.users.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: { id: true, type: true, phone: true, email: true, first_name: true, last_name: true, status: true, created_at: true, last_login_at: true },
      }),
      this.prisma.users.count({ where }),
    ]);
    return new Paginated(rows, { page: q.page, limit: q.limit, total });
  }
}
