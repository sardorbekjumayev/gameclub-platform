import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Grants } from '../../common/decorators/grants.decorator';
import { Idempotent } from '../../common/interceptors/idempotency.interceptor';
import { type Actor } from '../clubs/clubs.service';
import { RbacService, type Grant } from '../rbac/rbac.service';
import { CashPaymentDto, CloseShiftDto, CompleteRefundDto, CreatePaymentDto, DemoConfirmDto, OpenShiftDto, PaymentListQuery, RefundDto, RefundListQuery, RejectTransferDto, ShiftListQuery, TransferPaymentDto } from './dto/payments.dto';
import { PaymentsService } from './payments.service';

const uuid = new ParseUUIDPipe();

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly rbac: RbacService,
  ) {}

  @Post('payments') @Idempotent() @ApiOperation({ summary: 'Online to\'lov (checkout) yaratish' })
  create(@Body() dto: CreatePaymentDto, @CurrentUser() u: AuthUser) {
    return this.payments.checkout(u.id, dto.booking_id, dto.provider, dto.return_url);
  }

  @Post('payments/transfer') @Idempotent() @ApiOperation({ summary: "Mijoz: klub kartasiga o'tkazdim (klub tasdiqlashini kutadi)" })
  transfer(@Body() dto: TransferPaymentDto, @CurrentUser() u: AuthUser) {
    return this.payments.transfer(u.id, dto);
  }

  @Post('payments/:id/transfer/confirm') @RequirePermission('payments.create') @Idempotent() @ApiOperation({ summary: "Klub: o'tkazma keldi — bron tasdiqlanadi" })
  confirmTransfer(@Param('id', uuid) id: string, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.payments.confirmTransfer(id, g, a);
  }

  @Post('payments/:id/transfer/reject') @RequirePermission('payments.create') @Idempotent() @ApiOperation({ summary: "Klub: o'tkazma topilmadi" })
  rejectTransfer(@Param('id', uuid) id: string, @Body() dto: RejectTransferDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.payments.rejectTransfer(id, dto, g, a);
  }

  @Get('refunds') @RequirePermission('payments.refund') @ApiOperation({ summary: "Qaytarishlar (status=PENDING — klub qo'lda qaytarishi kerak)" })
  refunds(@Query() q: RefundListQuery, @Grants() g: Grant[]) {
    return this.payments.refunds(q, g);
  }

  @Post('refunds/:id/complete') @RequirePermission('payments.refund') @Idempotent() @ApiOperation({ summary: 'Klub: pul mijozga qaytarildi' })
  completeRefund(@Param('id', uuid) id: string, @Body() dto: CompleteRefundDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.payments.completeRefund(id, dto, g, a);
  }

  @Public() @Get('payments/providers') @ApiOperation({ summary: "Yoqilgan online to'lov provayderlari" })
  providers() {
    return this.payments.providersList();
  }

  @Post('payments/:id/demo/confirm') @ApiOperation({ summary: 'DEMO provayder: to\'lovni tasdiqlash/rad etish' })
  demo(@Param('id', uuid) id: string, @Body() dto: DemoConfirmDto, @CurrentUser() u: AuthUser) {
    return this.payments.demoConfirm(u.id, id, dto.success);
  }

  @Public() @Post('webhooks/payments/demo') @ApiOperation({ summary: 'DEMO webhook (X-Signature HMAC)' })
  webhook(@Req() req: Request, @Headers('x-signature') sig?: string) {
    return this.payments.demoWebhook(JSON.stringify(req.body ?? {}), sig);
  }

  @Post('payments/cash') @RequirePermission('payments.create') @Idempotent() @ApiOperation({ summary: 'Naqd/terminal to\'lov (ochiq smena talab qilinadi)' })
  cash(@Body() dto: CashPaymentDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.payments.cash(dto, g, a);
  }

  @Post('payments/:id/refund') @RequirePermission('payments.refund') @Idempotent()
  refund(@Param('id', uuid) id: string, @Body() dto: RefundDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.payments.refund(id, dto, g, a);
  }

  @Get('payments') @RequirePermission('payments.view')
  list(@Query() q: PaymentListQuery, @Grants() g: Grant[]) {
    return this.payments.list(q, g);
  }

  @Get('payments/:id')
  async get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.payments.get(id, u.id, await this.rbac.grants(u.id));
  }

  // ---------- Smena ----------
  @Get('shifts/current') @RequirePermission('shifts.open')
  current(@CurrentUser() u: AuthUser, @Query('branch_id') branchId?: string) {
    return this.payments.currentShift(u.id, branchId);
  }

  @Post('shifts/open') @RequirePermission('shifts.open')
  open(@Body() dto: OpenShiftDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.payments.openShift(dto, g, a);
  }

  @Post('shifts/:id/close') @RequirePermission('shifts.close')
  close(@Param('id', uuid) id: string, @Body() dto: CloseShiftDto, @Grants() g: Grant[], @CurrentActor() a: Actor) {
    return this.payments.closeShift(id, dto, g, a);
  }

  @Get('shifts') @RequirePermission('shifts.view_all')
  shifts(@Query() q: ShiftListQuery, @Grants() g: Grant[]) {
    return this.payments.shifts(q, g);
  }

  @Get('shifts/:id/report') @RequirePermission('shifts.open')
  report(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser, @Grants() g: Grant[]) {
    return this.payments.shiftReportFor(id, u.id, g);
  }
}
