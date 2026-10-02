import { Global, Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ClickMerchantService } from './providers/click.merchant';
import { ClickProvider } from './providers/click.provider';
import { DemoProvider } from './providers/demo.provider';
import { MerchantController } from './providers/merchant.controller';
import { PaymeMerchantService } from './providers/payme.merchant';
import { PaymeProvider } from './providers/payme.provider';
import { PaymentProviders } from './providers/registry';
import { ReconciliationService } from './reconciliation.service';

@Global()
@Module({
  controllers: [PaymentsController, MerchantController],
  providers: [PaymentsService, FinanceService, DemoProvider, PaymeProvider, ClickProvider, PaymentProviders, PaymeMerchantService, ClickMerchantService, ReconciliationService],
  exports: [PaymentsService, FinanceService, PaymentProviders],
})
export class PaymentsModule {}
