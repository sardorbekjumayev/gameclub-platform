import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '../../modules/rbac/catalog';

export const IS_PUBLIC = 'isPublic';
export const REQUIRED_PERMISSION = 'requiredPermission';
export const ALLOW_DURING_MAINTENANCE = 'allowDuringMaintenance';

/** JWT talab qilinmaydi. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** `maintenance_mode` yoqilganda ham ishlaydi (health, webhook, auth, ommaviy huquqiy hujjatlar). */
export const AllowDuringMaintenance = () => SetMetadata(ALLOW_DURING_MAINTENANCE, true);

/** Controllerda permission qattiq yozilmaydi — dekorator orqali (CLAUDE.md qoida 8). */
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION, permission);

export interface AuthUser {
  id: string;
  type: 'CUSTOMER' | 'STAFF' | 'PLATFORM';
  jti: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
