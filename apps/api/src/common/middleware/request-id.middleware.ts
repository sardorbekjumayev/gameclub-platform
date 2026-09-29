import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from '../utils/id';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = typeof incoming === 'string' && VALID_ID.test(incoming) ? incoming : uuidv7();
    req.headers[REQUEST_ID_HEADER] = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
