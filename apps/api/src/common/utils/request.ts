import type { Request } from 'express';

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? null;
export const userAgent = (req: Request) => (req.headers['user-agent'] as string | undefined) ?? null;
