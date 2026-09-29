import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/errors';
import { randomToken, sha256 } from '../../common/utils/crypto';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
export const ACCESS_TTL_S = 15 * 60;

export interface ClientInfo {
  ip: string | null;
  device_info?: Record<string, unknown> | null;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private async issueAccess(user: { id: string; type: string }) {
    return this.jwt.signAsync({ sub: user.id, type: user.type, jti: uuidv7() }, { expiresIn: ACCESS_TTL_S });
  }

  async issuePair(user: { id: string; type: string }, client: ClientInfo, familyId = uuidv7()) {
    const refresh = randomToken();
    const row = await this.prisma.refresh_tokens.create({
      data: {
        id: uuidv7(),
        user_id: user.id,
        family_id: familyId,
        token_hash: sha256(refresh),
        ip: client.ip,
        device_info: (client.device_info ?? undefined) as object | undefined,
        expires_at: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return {
      access_token: await this.issueAccess(user),
      refresh_token: refresh,
      expires_in: ACCESS_TTL_S,
      session_id: row.id,
    };
  }

  /** Rotation + reuse detection (docs/01-API.md §4.3). */
  async rotate(refresh: string, client: ClientInfo) {
    const row = await this.prisma.refresh_tokens.findUnique({
      where: { token_hash: sha256(refresh) },
      include: { user: true },
    });
    if (!row) throw new AppException('UNAUTHORIZED', 'Invalid refresh token');

    if (row.revoked_at) {
      // Eski token qayta ishlatildi — butun oila bekor qilinadi.
      await this.prisma.refresh_tokens.updateMany({
        where: { family_id: row.family_id, revoked_at: null },
        data: { revoked_at: new Date(), reuse_detected_at: new Date() },
      });
      throw new AppException('UNAUTHORIZED', 'Refresh token reuse detected');
    }
    if (row.expires_at <= new Date()) throw new AppException('TOKEN_EXPIRED', 'Refresh token expired');
    if (row.user.status !== 'ACTIVE' || row.user.deleted_at) throw new AppException('FORBIDDEN', 'Account disabled');

    const next = await this.issuePair(row.user, { ip: client.ip, device_info: row.device_info as any }, row.family_id);
    // Shartli yangilash: parallel ikki rotate'dan faqat bittasi muvaffaqiyatli.
    const { count } = await this.prisma.refresh_tokens.updateMany({
      where: { id: row.id, revoked_at: null },
      data: { revoked_at: new Date(), replaced_by_id: next.session_id },
    });
    if (count === 0) {
      await this.prisma.refresh_tokens.updateMany({
        where: { family_id: row.family_id, revoked_at: null },
        data: { revoked_at: new Date(), reuse_detected_at: new Date() },
      });
      throw new AppException('UNAUTHORIZED', 'Refresh token reuse detected');
    }
    return next;
  }

  async revoke(refresh: string, userId: string) {
    await this.prisma.refresh_tokens.updateMany({
      where: { token_hash: sha256(refresh), user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async revokeAll(userId: string) {
    await this.prisma.refresh_tokens.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
  }

  async listSessions(userId: string) {
    return this.prisma.refresh_tokens.findMany({
      where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } },
      select: { id: true, device_info: true, ip: true, created_at: true, expires_at: true },
      orderBy: { created_at: 'desc' },
    });
  }

  async revokeSession(userId: string, id: string) {
    const { count } = await this.prisma.refresh_tokens.updateMany({
      where: { id, user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    if (!count) throw new AppException('NOT_FOUND', 'Session not found');
  }
}
