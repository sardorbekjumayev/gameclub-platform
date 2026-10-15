import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './infra/redis/redis.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { UsersModule } from './modules/users/users.module';
import { ClubsModule } from './modules/clubs/clubs.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { DevicesModule } from './modules/devices/devices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { RentalsModule } from './modules/rentals/rentals.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PlansModule } from './modules/plans/plans.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TelegramBotModule } from './modules/telegram/bot/telegram-bot.module';
import { CoreServicesModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        genReqId: (req) => req.headers['x-request-id'] as string,
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        // Sezgir maydonlar log'ga tushmaydi (CLAUDE.md qoida 9)
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.code',
            'req.body.refresh_token',
            'req.body.token',
          ],
          remove: true,
        },
      },
    }),
    DatabaseModule,
    RedisModule,
    RateLimitModule,
    AuditModule,
    TelegramModule,
    RbacModule,
    AuthModule,
    UsersModule,
    RealtimeModule,
    CoreServicesModule,
    PlansModule,
    PayoutsModule,
    // DiscoveryModule ClubsModule'dan oldin: statik `/branches/map` dinamik `/branches/:idOrSlug` ga tushib qolmasin.
    DiscoveryModule,
    ClubsModule,
    PaymentsModule,
    BookingsModule,
    DevicesModule,
    SessionsModule,
    RentalsModule,
    EngagementModule,
    AnalyticsModule,
    TelegramBotModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
