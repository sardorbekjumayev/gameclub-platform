import { Module } from '@nestjs/common';
import { ClubApplicationsController } from './club-applications.controller';
import { ClubApplicationsService } from './club-applications.service';

/** Klub egalarining ulanish arizalari: zonup.uz formasi → super admin paneli. */
@Module({ controllers: [ClubApplicationsController], providers: [ClubApplicationsService] })
export class ClubApplicationsModule {}
