import { Module } from '@nestjs/common';
import { DiscoveryAliasController, DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

@Module({ controllers: [DiscoveryController, DiscoveryAliasController], providers: [DiscoveryService] })
export class DiscoveryModule {}
