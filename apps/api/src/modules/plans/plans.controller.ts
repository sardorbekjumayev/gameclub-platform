import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import type { Actor } from '../clubs/clubs.service';
import { AssignPlanDto, CreatePlanDto, SubscriptionListQuery, TrialSettingsDto, UpdatePlanDto } from './plans.dto';
import { PlansService } from './plans.service';

const uuid = new ParseUUIDPipe({ version: undefined });

@ApiTags('plans')
@ApiBearerAuth()
@Controller()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public() @Get('plans') @ApiOperation({ summary: 'Faol tarif rejalari (ommaviy)' })
  list() {
    return this.plans.publicList();
  }

  @Get('clubs/:clubId/subscription') @RequirePermission('clubs.view') @ApiOperation({ summary: 'Klubning joriy obunasi va limitlardan foydalanish' })
  clubSubscription(@Param('clubId', uuid) clubId: string) {
    return this.plans.clubSubscription(clubId);
  }

  // ---------- Super admin ----------
  @Get('admin/plans') @RequirePermission('platform.subscriptions.manage')
  adminList() {
    return this.plans.adminList();
  }

  @Post('admin/plans') @RequirePermission('platform.subscriptions.manage') @Idempotent()
  create(@Body() dto: CreatePlanDto, @CurrentActor() a: Actor) {
    return this.plans.create(dto, a);
  }

  @Get('admin/plans/trial') @RequirePermission('platform.subscriptions.manage') @ApiOperation({ summary: 'Yangi klub uchun sinov rejasi va muddati' })
  trial() {
    return this.plans.trialSettings();
  }

  @Put('admin/plans/trial') @RequirePermission('platform.subscriptions.manage')
  setTrial(@Body() dto: TrialSettingsDto, @CurrentActor() a: Actor) {
    return this.plans.setTrialSettings(dto, a);
  }

  @Patch('admin/plans/:id') @RequirePermission('platform.subscriptions.manage')
  update(@Param('id', uuid) id: string, @Body() dto: UpdatePlanDto, @CurrentActor() a: Actor) {
    return this.plans.update(id, dto, a);
  }

  @Delete('admin/plans/:id') @RequirePermission('platform.subscriptions.manage') @ApiOperation({ summary: 'Obunasi yo\'q rejani o\'chirish (aks holda nofaol qiling)' })
  remove(@Param('id', uuid) id: string, @CurrentActor() a: Actor) {
    return this.plans.remove(id, a);
  }

  @Get('admin/subscriptions') @RequirePermission('platform.subscriptions.manage')
  subscriptions(@Query() q: SubscriptionListQuery) {
    return this.plans.subscriptions(q);
  }

  @Post('admin/clubs/:id/subscription') @RequirePermission('platform.subscriptions.manage') @Idempotent() @ApiOperation({ summary: 'Klubga reja biriktirish (joriy obuna bekor qilinadi)' })
  assign(@Param('id', uuid) id: string, @Body() dto: AssignPlanDto, @CurrentActor() a: Actor) {
    return this.plans.assign(id, dto, a);
  }
}
