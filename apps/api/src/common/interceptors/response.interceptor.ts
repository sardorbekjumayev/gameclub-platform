import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { serialize } from '../serialize';

/** Controller `{ data, meta }` qaytarsa meta saqlanadi; aks holda natija `data` ga o'raladi. */
export class Paginated<T> {
  constructor(
    readonly data: T[],
    readonly meta: { page?: number; limit: number; total?: number; next_cursor?: string | null; [k: string]: unknown },
  ) {}
}

/** Tashqi protokol (Payme/Click) javobi — `{success,data}` ga o'ralmaydi. */
export class RawResponse {
  constructor(readonly body: unknown) {}
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result) =>
        result instanceof RawResponse
          ? serialize(result.body)
          : result instanceof Paginated
          ? { success: true, data: serialize(result.data), meta: result.meta, message: null }
          : { success: true, data: serialize(result ?? null), meta: null, message: null },
      ),
    );
  }
}
