import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { from, Observable, of, switchMap, tap } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../errors';
import { serialize } from '../serialize';
import { sha256 } from '../utils/crypto';
import { uuidv7 } from '../utils/id';

const TTL_MS = 48 * 3600 * 1000;

/**
 * `Idempotency-Key` (docs/01-API.md §3, CLAUDE.md qoida 6): bir xil key + body → oldingi javob;
 * boshqa body → IDEMPOTENCY_CONFLICT. Key berilmasa oddiy ishlaydi.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key || !req.user) return next.handle();
    const route = `${req.method} ${req.route?.path ?? req.path}:${JSON.stringify(req.params ?? {})}`;
    const hash = sha256(JSON.stringify(req.body ?? {}));
    return from(this.prisma.idempotency_keys.findUnique({ where: { key_user_id_route: { key, user_id: req.user.id, route } } })).pipe(
      switchMap((found) => {
        if (found && found.expires_at > new Date()) {
          if (found.request_hash !== hash) throw new AppException('IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with different body');
          if (found.response_body !== null) return of(found.response_body);
          throw new AppException('CONFLICT', 'Request with this Idempotency-Key is in progress');
        }
        const reserve = found
          ? this.prisma.idempotency_keys.update({ where: { id: found.id }, data: { request_hash: hash, response_body: Prisma.DbNull, expires_at: new Date(Date.now() + TTL_MS) } })
          : this.prisma.idempotency_keys.create({ data: { id: uuidv7(), key, user_id: req.user.id, route, request_hash: hash, expires_at: new Date(Date.now() + TTL_MS) } });
        return from(reserve).pipe(
          switchMap(() =>
            next.handle().pipe(
              tap({
                next: (body) =>
                  void this.prisma.idempotency_keys
                    .update({ where: { key_user_id_route: { key, user_id: req.user.id, route } }, data: { response_status: 200, response_body: serialize(body) as Prisma.InputJsonValue } })
                    .catch(() => undefined),
                error: () => void this.prisma.idempotency_keys.delete({ where: { key_user_id_route: { key, user_id: req.user.id, route } } }).catch(() => undefined),
              }),
            ),
          ),
        );
      }),
    );
  }
}

export const IDEMPOTENT = 'idempotent';
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, true),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({ name: 'Idempotency-Key', required: false, description: 'UUID; takroriy so\'rovdan himoya (48 soat)' }),
  );
