import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../clubs/clubs.service';
import { SETTINGS_KEY_MAP, UpdateSettingsDto } from './settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('platform-settings')
@ApiBearerAuth()
@Controller('admin/settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('platform.settings.manage')
  @ApiOperation({ summary: 'Super admin: barcha platforma sozlamalari (default + override)' })
  getAll() {
    return this.settings.all();
  }

  @Patch()
  @RequirePermission('platform.settings.manage')
  @ApiOperation({ summary: 'Super admin: sozlamalarni yangilash (oq ro\'yxatdagi kalitlar); audit yoziladi' })
  async update(@Body() dto: UpdateSettingsDto, @CurrentActor() a: Actor) {
    const changes = (Object.keys(dto) as (keyof UpdateSettingsDto)[])
      .filter((k) => dto[k] !== undefined)
      .map((k) => ({ key: SETTINGS_KEY_MAP[k], value: dto[k] as unknown }));
    if (changes.length === 0) throw new AppException('VALIDATION_ERROR', 'No settings provided', { reason: 'EMPTY' });

    const before = await this.settings.all();
    const oldValue = Object.fromEntries(changes.map((c) => [c.key, before[c.key]]));
    const newValue = Object.fromEntries(changes.map((c) => [c.key, c.value]));

    await this.prisma.$transaction(async (tx) => {
      for (const c of changes) await this.settings.set(c.key, c.value, a.id, tx);
      await this.audit.log(
        {
          actor_id: a.id, action: 'admin.settings.update', target_type: 'platform_settings', target_id: null,
          old_value: oldValue, new_value: newValue, ip: a.ip ?? null, user_agent: a.ua ?? null, request_id: a.request_id ?? null,
        },
        tx,
      );
    });
    this.settings.invalidate();
    return this.settings.all();
  }
}
