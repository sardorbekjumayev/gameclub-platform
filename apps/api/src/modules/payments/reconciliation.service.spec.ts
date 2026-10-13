import { PrismaService } from '../../database/prisma.service';
import { ReconciliationService } from './reconciliation.service';

/** Reconciliation: 24 soatdan eski PENDING online checkout'lar FAILED (CHECKOUT_EXPIRED), qolganlari faqat sanaladi. */
describe('ReconciliationService.run', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');
  const dayAgo = new Date('2026-10-12T12:00:00.000Z');

  function setup(stale: { id: string }[], stuck = 0, pendingRefunds = 0) {
    const prisma = {
      payments: {
        findMany: jest.fn(async () => stale),
        updateMany: jest.fn(async () => ({ count: 1 })),
        count: jest.fn(async () => stuck),
      },
      refunds: { count: jest.fn(async () => pendingRefunds) },
    };
    return { svc: new ReconciliationService(prisma as unknown as PrismaService), prisma };
  }

  it('expires only stale online PENDING checkouts, guarded by status (no overwrite of a just-paid payment)', async () => {
    const { svc, prisma } = setup([{ id: 'a' }, { id: 'b' }], 3, 2);
    expect(await svc.run(now)).toEqual({ expired: 2, stuck: 3, pendingRefunds: 2 });
    expect(prisma.payments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING', method: { in: ['ONLINE_CARD', 'WALLET'] }, created_at: { lt: dayAgo } } }),
    );
    expect(prisma.payments.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.payments.updateMany).toHaveBeenCalledWith({ where: { id: 'a', status: 'PENDING' }, data: { status: 'FAILED', failed_reason: 'CHECKOUT_EXPIRED' } });
    expect(prisma.payments.count).toHaveBeenCalledWith({ where: { status: 'PROCESSING', updated_at: { lt: dayAgo } } });
    expect(prisma.refunds.count).toHaveBeenCalledWith({ where: { status: 'PENDING', created_at: { lt: dayAgo } } });
  });

  it('nothing stale → no writes', async () => {
    const { svc, prisma } = setup([]);
    expect(await svc.run(now)).toEqual({ expired: 0, stuck: 0, pendingRefunds: 0 });
    expect(prisma.payments.updateMany).not.toHaveBeenCalled();
  });

  it('does not schedule a timer under NODE_ENV=test', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const spy = jest.spyOn(global, 'setInterval');
    try {
      setup([]).svc.onApplicationBootstrap();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      process.env.NODE_ENV = prev;
    }
  });
});
