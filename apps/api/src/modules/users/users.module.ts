import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountService } from './account.service';
import { UsersController } from './users.controller';

@Module({ imports: [AuthModule], controllers: [UsersController], providers: [AccountService] })
export class UsersModule {}
