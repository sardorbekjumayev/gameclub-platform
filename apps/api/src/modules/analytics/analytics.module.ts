import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { DailyStatsService } from './daily-stats.service';

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService, DailyStatsService] })
export class AnalyticsModule {}
