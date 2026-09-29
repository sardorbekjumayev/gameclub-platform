import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthUser, CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { clientIp, userAgent } from '../../common/utils/request';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, SendOtpDto, SetPasswordDto, VerifyOtpDto } from './dto/auth.dto';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

const meta = (req: Request, device?: Record<string, unknown>) => ({
  ip: clientIp(req),
  user_agent: userAgent(req),
  request_id: (req.headers['x-request-id'] as string) ?? null,
  device_info: { ...(device ?? {}), user_agent: userAgent(req) },
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('send-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telefonga OTP yuborish (dev: kod 000000)' })
  sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    return this.otp.send(dto.phone, dto.purpose, clientIp(req));
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'OTP tasdiqlash → login yoki ro\'yxatdan o\'tish' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    await this.otp.verify(dto.phone, dto.code);
    return this.auth.loginWithPhone(dto.phone, meta(req, dto.device));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login (email|telefon + parol) — staff, super admin, parolli customer' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.loginWithPassword(dto.login, dto.password, meta(req, dto.device));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh token rotation' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.tokens.rotate(dto.refresh_token, { ip: clientIp(req) });
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  async logout(@Body() dto: RefreshDto, @CurrentUser() user: AuthUser) {
    await this.tokens.revoke(dto.refresh_token, user.id);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.tokens.revokeAll(user.id);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Post('password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Parol o\'rnatish/o\'zgartirish' })
  async setPassword(@Body() dto: SetPasswordDto, @CurrentUser() user: AuthUser) {
    await this.auth.setPassword(user.id, dto.password);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Joriy foydalanuvchi + rollar + permissionlar' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.tokens.listSessions(user.id);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  async revokeSession(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    await this.tokens.revokeSession(user.id, id);
    return { ok: true };
  }
}
