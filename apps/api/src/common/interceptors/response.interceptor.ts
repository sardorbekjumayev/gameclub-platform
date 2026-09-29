import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

/** Controller `{ data, meta }` qaytarsa meta saqlanadi; aks holda natija `data` ga o'raladi. */
export class Paginated<T> {
  constructor(
    readonly data: T[],
    readonly meta: { page?: number; limit: number; total?: number; next_cursor?: string | null },
  ) {}
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result) =>
        result instanceof Paginated
          ? { success: true, data: result.data, meta: result.meta, message: null }
          : { success: true, data: result ?? null, meta: null, message: null },
      ),
    );
  }
}
