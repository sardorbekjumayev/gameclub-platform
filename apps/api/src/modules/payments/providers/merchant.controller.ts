import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllowDuringMaintenance, Public } from '../../../common/decorators/auth.decorators';
import { RawResponse } from '../../../common/interceptors/response.interceptor';
import { ClickMerchantService } from './click.merchant';
import { PaymeMerchantService } from './payme.merchant';
import { NoRateLimit } from '../../../common/rate-limit/rate-limit.decorators';

/** Provayderlar chaqiradigan endpointlar (imzo/Basic auth servis ichida tekshiriladi). */
@NoRateLimit()
@ApiExcludeController()
@AllowDuringMaintenance()
@Controller('webhooks/payments')
export class MerchantController {
  constructor(
    private readonly payme: PaymeMerchantService,
    private readonly click: ClickMerchantService,
  ) {}

  @Public() @Post('payme') @HttpCode(200)
  async paymeRpc(@Body() body: Record<string, unknown>, @Headers('authorization') auth?: string) {
    return new RawResponse(await this.payme.handle(body, auth));
  }

  @Public() @Post('click/prepare') @HttpCode(200)
  async clickPrepare(@Body() body: Record<string, string>) {
    return new RawResponse(await this.click.prepare(body));
  }

  @Public() @Post('click/complete') @HttpCode(200)
  async clickComplete(@Body() body: Record<string, string>) {
    return new RawResponse(await this.click.complete(body));
  }
}
