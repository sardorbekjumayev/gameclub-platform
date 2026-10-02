import { Global, Module } from '@nestjs/common';
import { MockSmsProvider, SmsProvider } from '../../infra/sms/sms.provider';
import { BranchesService } from './branches.service';
import { AdminClubsController, ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { EntitlementsService } from './entitlements.service';
import { StaffService } from './staff.service';

@Global()
@Module({
  controllers: [ClubsController, AdminClubsController],
  providers: [ClubsService, BranchesService, StaffService, EntitlementsService, { provide: SmsProvider, useClass: MockSmsProvider }],
  exports: [ClubsService, BranchesService, StaffService, EntitlementsService],
})
export class ClubsModule {}
