import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MockSmsProvider, SmsProvider } from '../../infra/sms/sms.provider';
import { JwtAuthGuard, PermissionGuard } from '../rbac/guards';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow('JWT_ACCESS_SECRET') }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    // Haqiqiy SMS gateway (Eskiz va h.k.) tanlangach shu yerda almashtiriladi (docs/00-README.md §8.3).
    { provide: SmsProvider, useClass: MockSmsProvider },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
