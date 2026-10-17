import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import type { Actor } from '../clubs/clubs.service';
import { LEGAL_DOCS } from './defaults';
import { LegalDocResponse, LegalQuery, UpdateLegalDto } from './legal.dto';
import { LegalService } from './legal.service';

const DOC_PARAM = {
  name: 'doc',
  enum: LEGAL_DOCS,
  description: 'offer — ommaviy oferta, privacy — maxfiylik siyosati, terms — foydalanish shartlari, partner — klublar uchun hamkorlik shartlari',
};

@ApiTags('legal')
@Controller()
export class LegalController {
  constructor(private readonly svc: LegalService) {}

  @Public()
  @Get('legal/:doc')
  @ApiParam(DOC_PARAM)
  @ApiOkResponse({ type: LegalDocResponse })
  @ApiOperation({ summary: "Huquqiy hujjat (ommaviy). Tahrirlanmagan bo'lsa — kod qoralamasi; noma'lum til — uz" })
  get(@Param('doc') doc: string, @Query() q: LegalQuery) {
    return this.svc.publicDoc(doc, q.lang);
  }

  @ApiBearerAuth()
  @Get('admin/legal/:doc')
  @RequirePermission('platform.settings.manage')
  @ApiParam(DOC_PARAM)
  @ApiOperation({ summary: 'Super admin: hujjatning uchala tildagi matni, versiya va chegaralar' })
  adminGet(@Param('doc') doc: string) {
    return this.svc.adminDoc(doc);
  }

  @ApiBearerAuth()
  @Put('admin/legal/:doc')
  @RequirePermission('platform.settings.manage')
  @ApiParam(DOC_PARAM)
  @ApiOperation({ summary: 'Super admin: bitta til matnini saqlash; versiya +1, audit (eski/yangi matn)' })
  update(@Param('doc') doc: string, @Body() dto: UpdateLegalDto, @CurrentActor() a: Actor) {
    return this.svc.update(doc, dto, a);
  }

  @ApiBearerAuth()
  @Post('legal/:doc/consent')
  @HttpCode(200)
  @ApiParam(DOC_PARAM)
  @ApiOperation({ summary: 'Hujjatning joriy versiyasiga rozilik berish (idempotent)' })
  consent(@Param('doc') doc: string, @CurrentActor() a: Actor) {
    return this.svc.recordConsent(a.id, doc, a.ip);
  }

  @ApiBearerAuth()
  @Get('me/consents')
  @ApiOperation({ summary: 'Mening roziliklarim: har hujjat bo\'yicha oxirgi qabul qilingan versiya' })
  myConsents(@CurrentUser() user: AuthUser) {
    return this.svc.myConsents(user.id);
  }
}
