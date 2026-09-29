import { Injectable, Logger } from '@nestjs/common';

export abstract class SmsProvider {
  abstract send(phone: string, text: string): Promise<void>;
}

/** Dev/test: SMS yuborilmaydi. Matn (kod) log'ga yozilmaydi — faqat maskalangan raqam. */
@Injectable()
export class MockSmsProvider extends SmsProvider {
  private readonly logger = new Logger('MockSms');
  async send(phone: string) {
    this.logger.log(`SMS -> ${phone.slice(0, 6)}***${phone.slice(-2)}`);
  }
}
