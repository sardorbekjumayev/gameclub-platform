import type { payments } from '@prisma/client';

export type ProviderCode = 'DEMO' | 'PAYME' | 'CLICK';

export interface CheckoutResult {
  url: string;
}
export interface ProviderRefundResult {
  /** COMPLETED — provayderda qaytarildi; PENDING — kabinetda qo'lda qaytarish kerak (provayder tasdiqlaganda yopiladi). */
  status: 'COMPLETED' | 'PENDING';
  provider_refund_id?: string | null;
  note?: string;
}

/** docs/01-API.md §6.10 — har provayder shu shaklda. Webhook qabul qilish har birining o'z controller'ida (protokollar har xil). */
export interface PaymentProvider {
  readonly code: ProviderCode;
  readonly name: string;
  enabled(): boolean | Promise<boolean>;
  createCheckout(p: payments, returnUrl?: string): CheckoutResult;
  refund(p: payments, amount: bigint): Promise<ProviderRefundResult>;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
