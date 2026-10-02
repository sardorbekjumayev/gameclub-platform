import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import type { Actor } from '../clubs/clubs.service';
import { CalculatePayoutsDto, MarkPaidDto, PayoutListQuery } from './payouts.dto';
import { PayoutsService } from './payouts.service';

const uuid = new ParseUUIDPipe();

@ApiTags('payouts')
@ApiBearerAuth()
@Controller()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('clubs/:clubId/payouts') @RequirePermission('reports.view') @ApiOperation({ summary: "Klubning payout'lari" })
  clubList(@Param('clubId', uuid) clubId: string, @Query() q: PayoutListQuery) {
    return this.payouts.list(q, clubId);
  }

  @Get('admin/payouts') @RequirePermission('platform.payouts.manage')
  list(@Query() q: PayoutListQuery) {
    return this.payouts.list(q);
  }
  @Post('admin/payouts/calculate') @RequirePermission('platform.payouts.manage') @Idempotent() @ApiOperation({ summary: "Davr bo'yicha payout hisoblash (takror davr o'tkazib yuboriladi)" })
  calculate(@Body() dto: CalculatePayoutsDto, @CurrentActor() a: Actor) {
    return this.payouts.calculate(dto, a);
  }
  @Post('admin/payouts/:id/mark-paid') @RequirePermission('platform.payouts.manage') @Idempotent()
  markPaid(@Param('id', uuid) id: string, @Body() dto: MarkPaidDto, @CurrentActor() a: Actor) {
    return this.payouts.markPaid(id, dto, a);
  }
  @Post('admin/payouts/:id/cancel') @RequirePermission('platform.payouts.manage')
  cancel(@Param('id', uuid) id: string, @CurrentActor() a: Actor) {
    return this.payouts.cancel(id, a);
  }
}
