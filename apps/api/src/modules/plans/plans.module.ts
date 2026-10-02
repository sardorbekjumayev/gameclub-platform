import { Global, Module } from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Global()
@Module({ controllers: [PlansController], providers: [PlansService], exports: [PlansService] })
export class PlansModule {}
