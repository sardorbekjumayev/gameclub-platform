import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Grant } from '../../modules/rbac/rbac.service';

/** PermissionGuard hisoblagan grantlar (faqat @RequirePermission bor endpointlarda to'ldiriladi). */
export const Grants = createParamDecorator((_: unknown, ctx: ExecutionContext): Grant[] => ctx.switchToHttp().getRequest().grants ?? []);
