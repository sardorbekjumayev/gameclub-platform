import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { catchError, concatMap, from, Observable, of, switchMap, throwError } from 'rxjs';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key || !req.user) return next.handle();
    const route = `${req.method} ${req.route?.path ?? req.path}:${JSON.stringify(req.params ?? {})}`;
    const hash = sha256(JSON.stringify(req.body ?? {}));
    const redact = this.reflector.get<string[] | undefined>(IDEMPOTENT_REDACT, ctx.getHandler()) ?? [];
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
          // Bir vaqtda kelgan ikkinchi so'rov unique constraint'ga uriladi — u ham "jarayonda"
          catchError((e) => {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppException('CONFLICT', 'Request with this Idempotency-Key is in progress');
            throw e;
          }),
          switchMap(() =>
            next.handle().pipe(
              // Javob klientga ketishidan oldin saqlanadi — darhol takrorlangan so'rov oldingi javobni oladi
              concatMap((body) =>
                from(
                  this.prisma.idempotency_keys
                    .update({ where: { key_user_id_route: { key, user_id: req.user.id, route } }, data: { response_status: 200, response_body: redacted(serialize(body), redact) as Prisma.InputJsonValue } })
                    .catch(() => undefined),
                ).pipe(switchMap(() => of(body))),
              ),
              // Xatoda kalit bo'shatiladi (xato klientga ketishidan oldin) — qayta urinish mumkin bo'lsin
              catchError((err) =>
                from(this.prisma.idempotency_keys.delete({ where: { key_user_id_route: { key, user_id: req.user.id, route } } }).catch(() => undefined)).pipe(
                  switchMap(() => throwError(() => err)),
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}

/** Saqlanadigan javobdan sezgir maydonlar (masalan vaqtinchalik parol) olib tashlanadi — takrorda `null` qaytadi. */
function redacted(body: unknown, fields: string[]) {
  if (!fields.length || !body || typeof body !== 'object') return body;
  return { ...(body as Record<string, unknown>), ...Object.fromEntries(fields.map((f) => [f, null])) };
}

export const IDEMPOTENT = 'idempotent';
export const IDEMPOTENT_REDACT = 'idempotent_redact';
export const Idempotent = (opts: { redact?: string[] } = {}) =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, true),
    SetMetadata(IDEMPOTENT_REDACT, opts.redact ?? []),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({ name: 'Idempotency-Key', required: false, description: 'UUID; takroriy so\'rovdan himoya (48 soat)' }),
  );
