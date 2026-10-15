import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException, ErrorCode } from '../errors';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

/** `http-errors` uslubidagi klient xatosi (`expose: true`, 4xx status). */
function isClientHttpError(e: unknown): e is Error & { status: number } {
  const x = e as { status?: unknown; expose?: unknown } | null;
  return e instanceof Error && typeof x?.status === 'number' && x.status >= 400 && x.status < 500 && x.expose === true;
}

/** Prisma: pool'dan ulanish olinmadi (P2024) yoki tranzaksiya kutish/vaqt chegarasidan oshdi (P2028). */
function isOverloaded(e: unknown): e is Error {
  if (!(e instanceof Error)) return false;
  const code = (e as { code?: string }).code;
  return code === 'P2024' || code === 'P2028' || /Timed out fetching a new connection|Transaction already closed|Unable to start a transaction in the given time/.test(e.message);
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const requestId = req.headers[REQUEST_ID_HEADER] as string | undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR';
      const body = exception.getResponse();
      if (typeof body === 'object' && body && Array.isArray((body as any).message)) {
        // class-validator xatolari
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        code = 'VALIDATION_ERROR';
        message = 'Validation failed';
        details = { errors: (body as any).message };
      } else {
        message = exception.message;
      }
    } else if (isClientHttpError(exception)) {
      // body-parser xatolari (masalan, 100 KB dan katta JSON — 413, buzuq JSON — 400) 500 emas
      status = exception.status;
      code = STATUS_TO_CODE[status] ?? 'VALIDATION_ERROR';
      message = exception.message;
    } else if (isOverloaded(exception)) {
      // DB ulanish pool'i to'lgan (yuklama cho'qqisi) — 500 emas, klient qayta urinadi
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'RATE_LIMITED';
      message = 'Server is busy, please retry';
      details = { retry_after: 2, reason: 'OVERLOADED' };
      res.setHeader('Retry-After', '2');
      this.logger.warn(`overloaded: ${(exception as Error).message.split('\n').pop()}`, requestId);
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception), requestId);
    }

    res.status(status).json({
      success: false,
      data: null,
      message,
      error: { code, details, request_id: requestId ?? null },
    });
  }
}
