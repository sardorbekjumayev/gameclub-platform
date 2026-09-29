import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/errors';
import { AuthUser, IS_PUBLIC, REQUIRED_PERMISSION } from '../../common/decorators/auth.decorators';
import { RbacService } from './rbac.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new AppException('UNAUTHORIZED', 'Authentication required');
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; type: AuthUser['type']; jti: string }>(token);
      req.user = { id: payload.sub, type: payload.type, jti: payload.jti } satisfies AuthUser;
      return true;
    } catch (e) {
      if (isPublic) return true;
      if ((e as Error).name === 'TokenExpiredError') throw new AppException('TOKEN_EXPIRED', 'Token expired');
      throw new AppException('UNAUTHORIZED', 'Invalid token');
    }
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!permission) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!req.user) throw new AppException('UNAUTHORIZED', 'Authentication required');

    const grants = await this.rbac.grants(req.user.id);
    // Marshrut parametrlaridan scope; resursga bog'liq scope (masalan /devices/:id) service'da tekshiriladi.
    const scope = { club_id: req.params?.clubId ?? null, branch_id: req.params?.branchId ?? null };
    if (!RbacService.allows(grants, permission, scope)) {
      throw new AppException('FORBIDDEN', 'Permission denied');
    }
    req.grants = grants;
    return true;
  }
}
