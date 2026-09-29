import { HttpException, HttpStatus } from '@nestjs/common';

/** Hujjatlashtirilgan xato kodlari (docs/01-API.md §3). Klient `error.code` bo'yicha ishlaydi. */
export const ErrorCodes = {
  VALIDATION_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  TOKEN_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  OTP_INVALID: HttpStatus.BAD_REQUEST,
  OTP_EXPIRED: HttpStatus.BAD_REQUEST,
  OTP_TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,
  BOOKING_SLOT_TAKEN: HttpStatus.CONFLICT,
  BOOKING_HOLD_EXPIRED: HttpStatus.CONFLICT,
  BOOKING_OUTSIDE_WORKING_HOURS: HttpStatus.UNPROCESSABLE_ENTITY,
  BOOKING_TOO_EARLY: HttpStatus.UNPROCESSABLE_ENTITY,
  BOOKING_TOO_LATE: HttpStatus.UNPROCESSABLE_ENTITY,
  BOOKING_NOT_CANCELLABLE: HttpStatus.CONFLICT,
  BOOKING_CHECKIN_WINDOW_CLOSED: HttpStatus.CONFLICT,
  CUSTOMER_BOOKING_BLOCKED: HttpStatus.FORBIDDEN,
  DEVICE_NOT_AVAILABLE: HttpStatus.CONFLICT,
  SESSION_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  SESSION_EXTEND_CONFLICT: HttpStatus.CONFLICT,
  PAYMENT_FAILED: HttpStatus.PAYMENT_REQUIRED,
  PAYMENT_ALREADY_PAID: HttpStatus.CONFLICT,
  REFUND_NOT_ALLOWED: HttpStatus.CONFLICT,
  PROMO_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  PLAN_LIMIT_REACHED: HttpStatus.FORBIDDEN,
  CLUB_NOT_ACTIVE: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message ?? code, ErrorCodes[code]);
  }
}
