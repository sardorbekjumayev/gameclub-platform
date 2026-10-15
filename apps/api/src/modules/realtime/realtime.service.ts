import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { serialize } from '../../common/serialize';

/** Server → klient eventlari (docs/01-API.md §9). */
export type LiveEvent =
  | 'device.status.changed'
  | 'booking.created'
  | 'booking.updated'
  | 'booking.cancelled'
  | 'rental.created'
  | 'rental.updated'
  | 'session.started'
  | 'session.updated'
  | 'session.ended'
  | 'payment.completed'
  | 'payment.transfer_pending'
  | 'payment.transfer_rejected'
  | 'shift.updated';

/**
 * Eventlarni xonalarga yuborish. Gateway ishga tushguncha (masalan testlarda) jim o'tadi —
 * real-time yordamchi kanal, manba haqiqat REST snapshot (`GET /branches/:id/live`).
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger('Realtime');
  private server: Server | null = null;
  private seq = 0;

  attach(server: Server) {
    this.server = server;
  }

  emit(room: string, event: LiveEvent, data: Record<string, unknown> = {}) {
    if (!this.server) return;
    try {
      this.server.to(room).emit(event, serialize({ ...data, seq: ++this.seq, at: new Date().toISOString() }));
    } catch (e) {
      // Event yuborilmasa ham REST amali muvaffaqiyatli — faqat log
      this.logger.warn(`emit ${event} failed: ${(e as Error).message}`);
    }
  }

  branch(branchId: string, event: LiveEvent, data: Record<string, unknown> = {}) {
    this.emit(`branch:${branchId}`, event, { branch_id: branchId, ...data });
  }

  user(userId: string | null | undefined, event: LiveEvent, data: Record<string, unknown> = {}) {
    if (userId) this.emit(`user:${userId}`, event, data);
  }

  /** Foydalanuvchining barcha ochiq socketlarini uzish (parol tiklanganda — sessiyalar bekor). */
  disconnectUser(userId: string) {
    try {
      this.server?.in(`user:${userId}`).disconnectSockets(true);
    } catch (e) {
      this.logger.warn(`disconnect failed: ${(e as Error).message}`);
    }
  }
}
