import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators';
import { DiscoveryService, MapQuery, SearchQuery } from './discovery.service';

@ApiTags('discovery')
@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public() @Get('nearby') @ApiOperation({ summary: 'Yaqin filiallar (PostGIS, masofa bilan)' })
  nearby(@Query() q: SearchQuery) {
    return this.discovery.nearby(q);
  }

  @Public() @Get('search') @ApiOperation({ summary: 'Qidiruv + filtrlar + saralash' })
  search(@Query() q: SearchQuery) {
    return this.discovery.search(q);
  }

  @Public() @Get('map') @ApiOperation({ summary: 'Xarita markerlari (bbox=w,s,e,n)' })
  map(@Query() q: MapQuery) {
    return this.discovery.map(q);
  }

  @Public() @Get('branches/:id/summary')
  summary(@Param('id', new ParseUUIDPipe()) id: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.discovery.summary(id, lat ? Number(lat) : undefined, lng ? Number(lng) : undefined);
  }
}

/** Hujjatdagi yo'llar bilan moslik: /branches/nearby|search|map (docs/01-API.md §6.7). */
@ApiTags('discovery')
@Controller('branches')
export class DiscoveryAliasController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public() @Get('nearby') nearby(@Query() q: SearchQuery) {
    return this.discovery.nearby(q);
  }
  @Public() @Get('search') search(@Query() q: SearchQuery) {
    return this.discovery.search(q);
  }
  @Public() @Get('map') map(@Query() q: MapQuery) {
    return this.discovery.map(q);
  }
  @Public() @Get(':id/summary') summary(@Param('id', new ParseUUIDPipe()) id: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    return this.discovery.summary(id, lat ? Number(lat) : undefined, lng ? Number(lng) : undefined);
  }
}
