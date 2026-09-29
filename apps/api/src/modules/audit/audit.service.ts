import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';

export interface AuditEntry {
  actor_id?: string | null;
  actor_role?: string | null;
  club_id?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  ip?: string | null;
  user_agent?: string | null;
  request_id?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma) {
    await tx.audit_logs.create({
      data: {
        ...entry,
        id: uuidv7(),
        old_value: (entry.old_value ?? undefined) as Prisma.InputJsonValue | undefined,
        new_value: (entry.new_value ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
