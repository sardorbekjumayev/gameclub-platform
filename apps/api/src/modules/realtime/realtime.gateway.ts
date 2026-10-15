import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../database/prisma.service';
import { REDIS } from '../../infra/redis/redis.module';
import { accessCutoffKey } from '../auth/password';
import { RbacService } from '../rbac/rbac.service';
import { RealtimeService } from './realtime.service';

type SocketData = { userId: string };
const ROOM = /^(branch|club):([0-9a-f-]{36})$|^platform$/i;

/**
 * Socket.IO (docs/01-API.md §9). Yo'l `/api/v1/ws` — web/admin Next rewrite (`/api/v1/*`) orqali ham ishlaydi.
 * Handshake: `auth.token` = access JWT. Xonaga obuna server tomonida permission bilan tekshiriladi.
 */
@WebSocketGateway({ path: '/api/v1/ws', addTrailingSlash: false, cors: { origin: true, credentials: true }, pingInterval: 25_000 })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('RealtimeGateway');

  constructor(
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  afterInit(server: Server) {
    // Bir nechta API replika uchun Redis adapter (testlarda o'chiq)
    if (this.config.get('NODE_ENV') !== 'test') server.adapter(createAdapter(this.redis.duplicate(), this.redis.duplicate()));
    this.realtime.attach(server);
  }

  async handleConnection(client: Socket) {
    const token = (client.handshake.auth as { token?: string } | undefined)?.token;
    try {
      if (!token) throw new Error('no token');
      const payload = await this.jwt.verifyAsync<{ sub: string; iat?: number }>(token);
      // Parol tiklangandan oldingi token bilan ulanib bo'lmaydi (JwtAuthGuard bilan bir xil qoida)
      const cutoff = await this.redis.get(accessCutoffKey(payload.sub));
      if (cutoff && (payload.iat ?? 0) < Number(cutoff)) throw new Error('revoked');
      (client.data as SocketData).userId = payload.sub;
      await client.join(`user:${payload.sub}`);
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { room?: string }) {
    const userId = (client.data as SocketData).userId;
    const room = String(body?.room ?? '');
    const m = ROOM.exec(room);
    if (!userId || !m) return { ok: false, error: 'VALIDATION_ERROR' };
    const grants = await this.rbac.grants(userId);
    let allowed = false;
    if (room === 'platform') {
      allowed = RbacService.allows(grants, 'platform.analytics.view');
    } else if (m[1] === 'branch') {
      const b = await this.prisma.branches.findFirst({ where: { id: m[2], deleted_at: null }, select: { club_id: true } });
      allowed = !!b && RbacService.allows(grants, 'sessions.view', { club_id: b.club_id, branch_id: m[2] });
    } else {
      allowed = RbacService.allows(grants, 'reports.view', { club_id: m[2], branch_id: null }) && grants.some((g) => g.scope_type === 'PLATFORM' || (g.scope_type === 'CLUB' && g.club_id === m[2]));
    }
    if (!allowed) return { ok: false, error: 'FORBIDDEN' };
    await client.join(room);
    return { ok: true, room, server_time: new Date().toISOString() };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { room?: string }) {
    if (body?.room && !body.room.startsWith('user:')) await client.leave(body.room);
    return { ok: true };
  }

  @SubscribeMessage('ping')
  ping() {
    return { ok: true, server_time: new Date().toISOString() };
  }
}
