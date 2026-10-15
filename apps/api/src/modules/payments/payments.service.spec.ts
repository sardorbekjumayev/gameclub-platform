import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { AppException } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FinanceService } from './finance.service';
import { PaymentsService } from './payments.service';
import { PaymentProviders } from './providers/registry';
import { FilesService } from '../files/files.service';

/** DEMO webhook: `X-Signature = hex(HMAC-SHA256(QR_HMAC_SECRET, "demo:" + body))`, imzo body'ga bog'langan. */
describe('PaymentsService demo webhook signature', () => {
  const SECRET = 'unit-secret-unit-secret-unit-secret-0123';
  const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(`demo:${body}`).digest('hex');

  function setup() {
    const config = { getOrThrow: (k: string) => (k === 'QR_HMAC_SECRET' ? SECRET : undefined) } as unknown as ConfigService;
    const svc = new PaymentsService(
      {} as PrismaService, {} as FinanceService, {} as AuditService, {} as NotificationsService, config, {} as RealtimeService, {} as PaymentProviders, {} as FilesService,
    );
    const handle = jest.spyOn(svc, 'handleEvent').mockResolvedValue({ processed: true, status: 'PAID', booking_status: 'CONFIRMED' });
    return { svc, handle };
  }

  const body = JSON.stringify({ event_id: 'ev-1', payment_id: '0190f1d2-3c4b-7a5e-8f60-123456789abc', status: 'PAID', transaction_id: 'tx-9' });

  it('signDemo matches the documented HMAC scheme', () => {
    expect(setup().svc.signDemo(body)).toBe(sign(body));
  });

  it('valid signature → normalized event forwarded to handleEvent', async () => {
    const { svc, handle } = setup();
    await svc.demoWebhook(body, sign(body));
    expect(handle).toHaveBeenCalledWith({ provider: 'DEMO', event_id: 'ev-1', payment_id: '0190f1d2-3c4b-7a5e-8f60-123456789abc', status: 'PAID', provider_transaction_id: 'tx-9', raw: JSON.parse(body) });
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['garbage', 'not-hex'],
    ['other secret', sign(body, 'another-secret-another-secret-another-0')],
    ['tampered body', sign(body.replace('PAID', 'FAILED'))],
    ['upper-cased hex', sign(body).toUpperCase()],
  ])('%s signature → UNAUTHORIZED, event not processed', async (_label, sig) => {
    const { svc, handle } = setup();
    const err = await svc.demoWebhook(body, sig).catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('UNAUTHORIZED');
    expect(handle).not.toHaveBeenCalled();
  });
});
