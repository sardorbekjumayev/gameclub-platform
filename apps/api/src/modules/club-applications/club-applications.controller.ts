import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../common/decorators/actor.decorator';
import { Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorators';
import type { Actor } from '../clubs/clubs.service';
import { ClubApplicationCreatedResponse, ClubApplicationListQuery, CreateClubApplicationDto, UpdateClubApplicationDto } from './club-applications.dto';
import { ClubApplicationsService } from './club-applications.service';

const uuid = new ParseUUIDPipe();

@ApiTags('club-applications')
@Controller()
export class ClubApplicationsController {
  constructor(private readonly svc: ClubApplicationsService) {}

  @Public()
  @RateLimit('sensitive')
  @Post('club-applications')
  @ApiCreatedResponse({ type: ClubApplicationCreatedResponse })
  @ApiOperation({ summary: "Klub egasining ulanish arizasi (ommaviy, akkauntsiz). Shu telefondan 24 soat ichidagi ochiq ariza takrorlanmaydi" })
  create(@Body() dto: CreateClubApplicationDto) {
    return this.svc.create(dto);
  }

  @ApiBearerAuth()
  @Get('admin/club-applications/stats')
  @RequirePermission('platform.clubs.approve')
  @ApiOperation({ summary: 'Yangi (ko\'rilmagan) va ochiq arizalar soni — menyu badge\'i' })
  stats() {
    return this.svc.stats();
  }

  @ApiBearerAuth()
  @Get('admin/club-applications')
  @RequirePermission('platform.clubs.approve')
  @ApiOperation({ summary: 'Klub arizalari ro\'yxati (status, qidiruv: klub/ism/shahar/telefon)' })
  list(@Query() q: ClubApplicationListQuery) {
    return this.svc.list(q);
  }

  @ApiBearerAuth()
  @Get('admin/club-applications/:id')
  @RequirePermission('platform.clubs.approve')
  get(@Param('id', uuid) id: string) {
    return this.svc.get(id);
  }

  @ApiBearerAuth()
  @Patch('admin/club-applications/:id')
  @RequirePermission('platform.clubs.approve')
  @ApiOperation({ summary: 'Holat (NEW → CONTACTED → APPROVED | REJECTED) va ichki izoh; audit log' })
  update(@Param('id', uuid) id: string, @Body() dto: UpdateClubApplicationDto, @CurrentActor() a: Actor) {
    return this.svc.update(id, dto, a);
  }
}
