import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors';
import { uuidv7 } from '../../common/utils/id';
import { PrismaService } from '../../database/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentProviders } from './providers/registry';

type Tx = Prisma.TransactionClient;

/**
 * Moliya yadrosi (docs/01-API.md §6.10): to'lovni tasdiqlash, komissiya, ledger (double-entry), refund.
 * Barcha metodlar chaqiruvchining tranzaksiyasida ishlaydi.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly providers: PaymentProviders,
  ) {}

  async commissionBps(clubId: string, tx: Tx = this.prisma) {
    const club = await tx.clubs.findUnique({ where: { id: clubId }, select: { commission_bps: true } });
    return club?.commission_bps ?? (await this.settings.get<number>('commission.default_bps')) ?? 0;
  }

  private async ledger(tx: Tx, rows: { account: string; account_id?: string | null; direction: 'DEBIT' | 'CREDIT'; amount: bigint; ref_type: string; ref_id: string }[]) {
    const data = rows.filter((r) => r.amount > 0n).map((r) => ({ id: uuidv7(), ...r }));
    if (data.length) await tx.ledger_entries.createMany({ data });
  }

  /** Bron summalarini to'lovlar bo'yicha qayta hisoblash (paid_amount, payment_status). */
  async syncBookingPayment(tx: Tx, bookingId: string) {
    const b = await tx.bookings.findUniqueOrThrow({ where: { id: bookingId } });
    const pays = await tx.payments.findMany({ where: { booking_id: bookingId, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } });
    const paid = pays.reduce((s, p) => s + p.amount, 0n);
    const refunded = pays.reduce((s, p) => s + p.refunded_amount, 0n);
    const net = paid - refunded;
    let payment_status = 'UNPAID';
    if (refunded > 0n && net <= 0n) payment_status = 'REFUNDED';
    else if (refunded > 0n) payment_status = 'PARTIALLY_REFUNDED';
    else if (paid >= b.total_amount && paid > 0n) payment_status = 'PAID';
    else if (paid > 0n) payment_status = 'PARTIAL';
    return tx.bookings.update({ where: { id: bookingId }, data: { paid_amount: net < 0n ? 0n : net, payment_status, refund_amount: refunded > 0n ? refunded : null } });
  }

  /** Arenda summalarini to'lovlar bo'yicha qayta hisoblash. */
  async syncRentalPayment(tx: Tx, rentalId: string) {
    const r = await tx.rentals.findUniqueOrThrow({ where: { id: rentalId } });
    const pays = await tx.payments.findMany({ where: { rental_id: rentalId, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } });
    const paid = pays.reduce((s, p) => s + p.amount, 0n);
    const refunded = pays.reduce((s, p) => s + p.refunded_amount, 0n);
    const net = paid - refunded;
    let payment_status = 'UNPAID';
    if (refunded > 0n && net <= 0n) payment_status = 'REFUNDED';
    else if (refunded > 0n) payment_status = 'PARTIALLY_REFUNDED';
    else if (paid >= r.total_amount && paid > 0n) payment_status = 'PAID';
    else if (paid > 0n) payment_status = 'PARTIAL';
    return tx.rentals.update({ where: { id: rentalId }, data: { paid_amount: net < 0n ? 0n : net, payment_status } });
  }

  /** To'lovni PAID qilish + komissiya + ledger. Online to'lovlarga komissiya; naqd/terminalga yo'q (klub kassasiga tushadi). */
  async markPaid(tx: Tx, paymentId: string, providerTxId?: string) {
    const p = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === 'PAID') return p;
    const online = p.method === 'ONLINE_CARD' || p.method === 'WALLET';
    const bps = online ? await this.commissionBps(p.club_id, tx) : 0;
    const commission = (p.amount * BigInt(bps)) / 10000n;
    const paid = await tx.payments.update({
      where: { id: paymentId },
      data: { status: 'PAID', paid_at: new Date(), provider_transaction_id: providerTxId ?? p.provider_transaction_id, commission_bps: bps, commission_amount: commission, club_amount: p.amount - commission },
    });
    await this.ledger(tx, [
      { account: 'CUSTOMER', account_id: p.user_id, direction: 'DEBIT', amount: p.amount, ref_type: 'payment', ref_id: p.id },
      { account: 'CLUB', account_id: p.club_id, direction: 'CREDIT', amount: p.amount - commission, ref_type: 'payment', ref_id: p.id },
      { account: 'PLATFORM', direction: 'CREDIT', amount: commission, ref_type: 'payment', ref_id: p.id },
    ]);
    if (commission > 0n) {
      // platform_commissions — payout hisobi uchun
    }
    if (p.booking_id) await this.syncBookingPayment(tx, p.booking_id);
    if (p.rental_id) await this.syncRentalPayment(tx, p.rental_id);
    return paid;
  }

  /** Naqd/terminal to'lov (operator). Ochiq smena talab qilinadi. */
  async recordOffline(tx: Tx, input: { club_id: string; branch_id: string; booking_id?: string | null; session_id?: string | null; rental_id?: string | null; user_id?: string | null; amount: bigint; method: 'CASH' | 'TERMINAL'; operator_id: string; shift_id: string }) {
    if (input.amount <= 0n) throw new AppException('VALIDATION_ERROR', 'Amount must be positive', { field: 'amount' });
    const p = await tx.payments.create({
      data: {
        id: uuidv7(), club_id: input.club_id, branch_id: input.branch_id, booking_id: input.booking_id, session_id: input.session_id, rental_id: input.rental_id, user_id: input.user_id,
        amount: input.amount, method: input.method, provider: 'MANUAL', status: 'PENDING', received_by: input.operator_id, shift_id: input.shift_id,
      },
    });
    return this.markPaid(tx, p.id);
  }

  /**
   * Bron bo'yicha refund: eng oxirgi PAID to'lovlardan boshlab taqsimlanadi.
   * Online (demo) provayder refundi darhol COMPLETED; naqd refund operator kassasidan (smena hisobotiga tushadi);
   * kartaga o'tkazma refundi PENDING — klub qaytargach `POST /refunds/:id/complete`.
   */
  async refundBooking(tx: Tx, bookingId: string, amount: bigint, reason: string, actorId: string | null, policySnapshot?: unknown) {
    if (amount <= 0n) return 0n;
    const pays = await tx.payments.findMany({ where: { booking_id: bookingId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } }, orderBy: { paid_at: 'desc' } });
    let left = amount;
    for (const p of pays) {
      if (left <= 0n) break;
      const available = p.amount - p.refunded_amount;
      if (available <= 0n) continue;
      const r = left < available ? left : available;
      await this.refundPayment(tx, p.id, r, reason, actorId, policySnapshot);
      left -= r;
    }
    await this.syncBookingPayment(tx, bookingId);
    return amount - left;
  }

  /**
   * `providerDone` — qaytarish provayder tomonida allaqachon bo'lgan (masalan Payme CancelTransaction);
   * aks holda online to'lov uchun provider.refund chaqiriladi (COMPLETED yoki kabinetda qo'lda — PENDING).
   */
  async refundPayment(tx: Tx, paymentId: string, amount: bigint, reason: string, actorId: string | null, policySnapshot?: unknown, providerDone = false) {
    const p = await tx.payments.findUniqueOrThrow({ where: { id: paymentId } });
    const available = p.amount - p.refunded_amount;
    if (!['PAID', 'PARTIALLY_REFUNDED'].includes(p.status) || amount > available || amount <= 0n) {
      throw new AppException('REFUND_NOT_ALLOWED', 'Refund amount exceeds refundable balance', { refundable: Number(available) });
    }
    const provider = p.provider === 'MANUAL' || providerDone ? null : this.providers.find(p.provider);
    // Kartaga o'tkazma: klub pulni mijozga o'zi qaytaradi va "qaytarildi" deb belgilaydi (PENDING → COMPLETED)
    const pr = p.method === 'CARD_TRANSFER' && !providerDone
      ? { status: 'PENDING' as const, provider_refund_id: null }
      : provider ? await provider.refund(p, amount) : { status: 'COMPLETED' as const, provider_refund_id: null };
    const refund = await tx.refunds.create({
      data: {
        id: uuidv7(), payment_id: p.id, booking_id: p.booking_id, club_id: p.club_id, amount, reason, status: pr.status, initiated_by: actorId,
        provider_refund_id: pr.provider_refund_id ?? null, policy_snapshot: (policySnapshot ?? undefined) as Prisma.InputJsonValue | undefined, completed_at: pr.status === 'COMPLETED' ? new Date() : null,
      },
    });
    const refunded = p.refunded_amount + amount;
    await tx.payments.update({ where: { id: p.id }, data: { refunded_amount: refunded, status: refunded >= p.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    if (p.rental_id) await this.syncRentalPayment(tx, p.rental_id);
    // Teskari ledger: komissiya ulushi proporsional qaytariladi
    const commission = p.commission_amount ?? 0n;
    const platformPart = p.amount > 0n ? (amount * commission) / p.amount : 0n;
    await this.ledger(tx, [
      { account: 'CUSTOMER', account_id: p.user_id, direction: 'CREDIT', amount, ref_type: 'refund', ref_id: refund.id },
      { account: 'CLUB', account_id: p.club_id, direction: 'DEBIT', amount: amount - platformPart, ref_type: 'refund', ref_id: refund.id },
      { account: 'PLATFORM', direction: 'DEBIT', amount: platformPart, ref_type: 'refund', ref_id: refund.id },
    ]);
    return refund;
  }

  async openShift(tx: Tx, operatorId: string, branchId: string) {
    const shift = await tx.cash_shifts.findFirst({ where: { operator_id: operatorId, branch_id: branchId, status: 'OPEN' } });
    if (!shift) throw new AppException('CONFLICT', 'Open a cash shift first', { reason: 'SHIFT_REQUIRED' });
    return shift;
  }
}
