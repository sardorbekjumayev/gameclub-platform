import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type payments } from '@prisma/client';
import { safeEqual } from '../../../common/utils/crypto';
import { PrismaService } from '../../../database/prisma.service';
import { FinanceService } from '../finance.service';
import { PaymentsService } from '../payments.service';
import { PaymeProvider } from './payme.provider';

type Rpc = { id?: number | string; method?: string; params?: Record<string, unknown> };
type PaymeTx = { id: string; time: number; create_time: number; perform_time: number; cancel_time: number; state: 1 | 2 | -1 | -2; reason: number | null };

const TIMEOUT_MS = 12 * 3600_000;
const msg = (uz: string, ru: string, en: string) => ({ uz, ru, en });

class RpcError extends Error {
  constructor(
    readonly code: number,
    readonly text: { uz: string; ru: string; en: string },
    readonly data?: string,
  ) {
    super(text.en);
  }
}

const E = {
  auth: () => new RpcError(-32504, msg("Ruxsat yo'q", 'Недостаточно привилегий', 'Insufficient privileges')),
  method: () => new RpcError(-32601, msg('Metod topilmadi', 'Метод не найден', 'Method not found')),
  amount: () => new RpcError(-31001, msg("Noto'g'ri summa", 'Неверная сумма', 'Invalid amount')),
  notFoundOrder: () => new RpcError(-31050, msg("To'lov topilmadi", 'Платёж не найден', 'Payment not found'), 'payment_id'),
  busy: () => new RpcError(-31051, msg("To'lov boshqa tranzaksiyada", 'Платёж ожидает другую транзакцию', 'Payment is awaiting another transaction'), 'payment_id'),
  cannot: () => new RpcError(-31008, msg("Amalni bajarib bo'lmaydi", 'Невозможно выполнить операцию', 'Unable to perform operation')),
  txNotFound: () => new RpcError(-31003, msg('Tranzaksiya topilmadi', 'Транзакция не найдена', 'Transaction not found')),
};

/**
 * Payme merchant API (JSON-RPC 2.0): CheckPerformTransaction, CreateTransaction, PerformTransaction,
 * CancelTransaction, CheckTransaction, GetStatement. Tranzaksiya holati `payments.provider_payload.payme` da.
 * Javob doim HTTP 200; xato `error` maydonida.
 */
@Injectable()
export class PaymeMerchantService {
  private readonly log = new Logger('PaymeMerchant');

  constructor(
    private readonly prisma: PrismaService,
    private readonly payme: PaymeProvider,
    private readonly payments: PaymentsService,
    private readonly finance: FinanceService,
  ) {}

  async handle(body: Rpc, authorization: string | undefined) {
    try {
      this.auth(authorization);
      const params = body.params ?? {};
      let result: unknown;
      switch (body.method) {
        case 'CheckPerformTransaction': result = await this.checkPerform(params); break;
        case 'CreateTransaction': result = await this.create(params); break;
        case 'PerformTransaction': result = await this.perform(params); break;
        case 'CancelTransaction': result = await this.cancel(params); break;
        case 'CheckTransaction': result = await this.check(params); break;
        case 'GetStatement': result = await this.statement(params); break;
        default: throw E.method();
      }
      return { jsonrpc: '2.0', id: body.id ?? null, result };
    } catch (e) {
      if (e instanceof RpcError) return { jsonrpc: '2.0', id: body.id ?? null, error: { code: e.code, message: e.text, data: e.data } };
      this.log.error(`payme ${body.method} failed: ${(e as Error).message}`);
      return { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32400, message: msg('Tizim xatosi', 'Системная ошибка', 'System error') } };
    }
  }

  private auth(h: string | undefined) {
    if (!this.payme.enabled() || !h?.startsWith('Basic ')) throw E.auth();
    const decoded = Buffer.from(h.slice(6), 'base64').toString();
    if (!safeEqual(decoded, `Paycom:${this.payme.key}`)) throw E.auth();
  }

  private txOf(p: payments): PaymeTx | null {
    return ((p.provider_payload as { payme?: PaymeTx } | null)?.payme as PaymeTx | undefined) ?? null;
  }

  private async saveTx(p: payments, tx: PaymeTx, extra: Prisma.paymentsUpdateInput = {}) {
    const payload = { ...((p.provider_payload as object | null) ?? {}), payme: tx };
    return this.prisma.payments.update({ where: { id: p.id }, data: { provider_payload: payload as Prisma.InputJsonValue, provider_transaction_id: tx.id, ...extra } });
  }

  private async order(params: Record<string, unknown>) {
    const id = (params.account as { payment_id?: string } | undefined)?.payment_id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw E.notFoundOrder();
    const p = await this.prisma.payments.findFirst({ where: { id, provider: 'PAYME' } });
    if (!p) throw E.notFoundOrder();
    if (BigInt(Math.round(Number(params.amount))) !== p.amount) throw E.amount();
    return p;
  }

  private async byTxId(params: Record<string, unknown>) {
    const p = await this.prisma.payments.findFirst({ where: { provider: 'PAYME', provider_transaction_id: String(params.id ?? '') } });
    const tx = p ? this.txOf(p) : null;
    if (!p || !tx) throw E.txNotFound();
    return { p, tx };
  }

  private async checkPerform(params: Record<string, unknown>) {
    const p = await this.order(params);
    if (!['PENDING', 'PROCESSING'].includes(p.status)) throw E.cannot();
    return { allow: true };
  }

  private async create(params: Record<string, unknown>) {
    const txId = String(params.id ?? '');
    const existing = await this.prisma.payments.findFirst({ where: { provider: 'PAYME', provider_transaction_id: txId } });
    if (existing) {
      const tx = this.txOf(existing)!;
      if (tx.state !== 1) throw E.cannot();
      if (Date.now() - tx.create_time > TIMEOUT_MS) {
        await this.expire(existing, tx);
        throw E.cannot();
      }
      return { create_time: tx.create_time, transaction: existing.id, state: tx.state };
    }
    const p = await this.order(params);
    if (!['PENDING', 'PROCESSING'].includes(p.status)) throw E.cannot();
    const cur = this.txOf(p);
    if (cur && cur.state === 1 && cur.id !== txId) throw E.busy();
    const tx: PaymeTx = { id: txId, time: Number(params.time ?? Date.now()), create_time: Date.now(), perform_time: 0, cancel_time: 0, state: 1, reason: null };
    await this.saveTx(p, tx, { status: 'PROCESSING' });
    return { create_time: tx.create_time, transaction: p.id, state: 1 };
  }

  private async perform(params: Record<string, unknown>) {
    const { p, tx } = await this.byTxId(params);
    if (tx.state === 2) return { transaction: p.id, perform_time: tx.perform_time, state: 2 };
    if (tx.state !== 1) throw E.cannot();
    if (Date.now() - tx.create_time > TIMEOUT_MS) {
      await this.expire(p, tx);
      throw E.cannot();
    }
    await this.payments.handleEvent({ provider: 'PAYME', event_id: `perform-${tx.id}`, payment_id: p.id, status: 'PAID', provider_transaction_id: tx.id, raw: params });
    const next = { ...tx, state: 2 as const, perform_time: Date.now() };
    await this.saveTx(await this.prisma.payments.findUniqueOrThrow({ where: { id: p.id } }), next);
    return { transaction: p.id, perform_time: next.perform_time, state: 2 };
  }

  private async cancel(params: Record<string, unknown>) {
    const { p, tx } = await this.byTxId(params);
    const reason = Number(params.reason ?? 0) || null;
    if (tx.state < 0) return { transaction: p.id, cancel_time: tx.cancel_time, state: tx.state };
    if (tx.state === 1) {
      await this.payments.handleEvent({ provider: 'PAYME', event_id: `cancel-${tx.id}`, payment_id: p.id, status: 'FAILED', raw: params });
      const next = { ...tx, state: -1 as const, cancel_time: Date.now(), reason };
      await this.saveTx(await this.prisma.payments.findUniqueOrThrow({ where: { id: p.id } }), next);
      return { transaction: p.id, cancel_time: next.cancel_time, state: -1 };
    }
    // state 2 → Payme'da qaytarildi: kutilayotgan (kabinetdan) refundlarni yopamiz, qolganini refund qilamiz
    await this.prisma.$transaction(async (db) => {
      const pending = await db.refunds.findMany({ where: { payment_id: p.id, status: 'PENDING' } });
      if (pending.length) await db.refunds.updateMany({ where: { id: { in: pending.map((r) => r.id) } }, data: { status: 'COMPLETED', completed_at: new Date(), provider_refund_id: `payme-${tx.id}` } });
      const fresh = await db.payments.findUniqueOrThrow({ where: { id: p.id } });
      const left = fresh.amount - fresh.refunded_amount;
      if (left > 0n) await this.finance.refundPayment(db, p.id, left, `Payme cancel (reason ${reason ?? '-'})`, null, undefined, true);
      if (p.booking_id) await this.finance.syncBookingPayment(db, p.booking_id);
    });
    const next = { ...tx, state: -2 as const, cancel_time: Date.now(), reason };
    await this.saveTx(await this.prisma.payments.findUniqueOrThrow({ where: { id: p.id } }), next);
    return { transaction: p.id, cancel_time: next.cancel_time, state: -2 };
  }

  private async check(params: Record<string, unknown>) {
    const { p, tx } = await this.byTxId(params);
    return { create_time: tx.create_time, perform_time: tx.perform_time, cancel_time: tx.cancel_time, transaction: p.id, state: tx.state, reason: tx.reason };
  }

  private async statement(params: Record<string, unknown>) {
    const from = Number(params.from ?? 0);
    const to = Number(params.to ?? Date.now());
    const rows = await this.prisma.payments.findMany({ where: { provider: 'PAYME', provider_transaction_id: { not: null } }, orderBy: { created_at: 'asc' } });
    const transactions = rows
      .map((p) => ({ p, tx: this.txOf(p) }))
      .filter((x): x is { p: payments; tx: PaymeTx } => !!x.tx && x.tx.time >= from && x.tx.time <= to)
      .map(({ p, tx }) => ({ id: tx.id, time: tx.time, amount: Number(p.amount), account: { payment_id: p.id }, create_time: tx.create_time, perform_time: tx.perform_time, cancel_time: tx.cancel_time, transaction: p.id, state: tx.state, reason: tx.reason }));
    return { transactions };
  }

  private async expire(p: payments, tx: PaymeTx) {
    await this.payments.handleEvent({ provider: 'PAYME', event_id: `timeout-${tx.id}`, payment_id: p.id, status: 'FAILED', raw: { timeout: true } });
    await this.saveTx(await this.prisma.payments.findUniqueOrThrow({ where: { id: p.id } }), { ...tx, state: -1, cancel_time: Date.now(), reason: 4 });
  }
}
