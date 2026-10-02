import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { Grants } from '../../common/decorators/grants.decorator';
import { AppException } from '../../common/errors';
import { type Grant } from '../rbac/rbac.service';
import { AnalyticsService, ClubAnalyticsQuery, PlatformAnalyticsQuery } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('analytics/club/overview') @RequirePermission('reports.view') @ApiOperation({ summary: 'KPI kartalar (oldingi davr bilan)' })
  overview(@Query() q: ClubAnalyticsQuery, @Grants() g: Grant[]) {
    return this.analytics.clubOverview(q, g);
  }
  @Get('analytics/club/revenue') @RequirePermission('reports.view')
  revenue(@Query() q: ClubAnalyticsQuery, @Grants() g: Grant[]) {
    return this.analytics.revenue(q, g);
  }
  @Get('analytics/club/peak-hours') @RequirePermission('reports.view')
  peak(@Query() q: ClubAnalyticsQuery, @Grants() g: Grant[]) {
    return this.analytics.peakHours(q, g);
  }
  @Get('analytics/club/devices/popular') @RequirePermission('reports.view')
  devices(@Query() q: ClubAnalyticsQuery, @Grants() g: Grant[]) {
    return this.analytics.popularDevices(q, g);
  }
  @Get('analytics/club/daily') @RequirePermission('reports.view') @ApiOperation({ summary: 'Kunlik agregatlar (daily_branch_stats)' })
  daily(@Query() q: ClubAnalyticsQuery, @Grants() g: Grant[]) {
    return this.analytics.daily(q, g);
  }
  @Get('analytics/club/branches/compare') @RequirePermission('reports.view')
  compare(@Query() q: ClubAnalyticsQuery, @Grants() g: Grant[]) {
    return this.analytics.compareBranches(q, g);
  }
  @Get('analytics/platform/overview') @RequirePermission('platform.analytics.view')
  platform(@Query() q: PlatformAnalyticsQuery) {
    return this.analytics.platformOverview(q);
  }
  @Get('analytics/platform/growth') @RequirePermission('platform.analytics.view')
  growth(@Query() q: PlatformAnalyticsQuery) {
    return this.analytics.platformGrowth(q);
  }

  @Get('reports/:kind') @RequirePermission('reports.export') @ApiOperation({ summary: 'Eksport: bookings | payments | shifts; ?format=csv|xlsx' })
  async export(@Param('kind') kind: string, @Query() q: ClubAnalyticsQuery, @Grants() g: Grant[], @Res() res: Response) {
    if (!['bookings', 'payments', 'shifts'].includes(kind)) throw new AppException('NOT_FOUND', 'Unknown report');
    const day = new Date().toISOString().slice(0, 10);
    if (q.format === 'xlsx') {
      const buf = await this.analytics.exportXlsx(kind as 'bookings', q, g);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${kind}-${day}.xlsx"`);
      res.send(buf);
      return;
    }
    const csv = await this.analytics.exportCsv(kind as 'bookings', q, g);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-${day}.csv"`);
    res.send(csv);
  }
}
