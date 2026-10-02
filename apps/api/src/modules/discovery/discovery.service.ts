import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { openState, WorkingHours } from '../../common/domain/working-hours';
import { AppException } from '../../common/errors';
import { Paginated } from '../../common/interceptors/response.interceptor';
import { PrismaService } from '../../database/prisma.service';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';
const toArr = ({ value }: { value: unknown }) => (Array.isArray(value) ? value : typeof value === 'string' && value ? value.split(',') : undefined);

export class SearchQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @ApiPropertyOptional({ description: 'metr' }) @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(100_000) radius?: number;
  @ApiPropertyOptional({ enum: ['distance', 'price', 'rating', 'popularity'] }) @IsOptional() @IsIn(['distance', 'price', 'rating', 'popularity']) sort?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) price_min?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) price_max?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(5) rating_min?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) open_now?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) available_now?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() device_type?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @Transform(toArr) @IsArray() @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}

export class MapQuery {
  @ApiPropertyOptional({ example: '69.1,41.2,69.4,41.4' }) @Matches(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/) bbox!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(22) zoom?: number;
}

interface Row {
  id: string;
  club_id: string;
  name: string;
  slug: string;
  address: string;
  latitude: number;
  longitude: number;
  cover_url: string | null;
  rating_avg: Prisma.Decimal;
  rating_count: number;
  working_hours: WorkingHours;
  timezone: string;
  amenities: string[];
  club_name: string;
  club_slug: string;
  club_logo: string | null;
  distance_m: number | null;
}

/** docs/01-API.md §6.7 — faqat ACTIVE klub + ACTIVE filial. */
@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  private async enrich(rows: Row[]) {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return [];
    const now = new Date();
    const [prices, devices, busyItems, sessions, exceptions, popularity] = await Promise.all([
      this.prisma.tariffs.groupBy({ by: ['branch_id'], where: { branch_id: { in: ids }, deleted_at: null, is_active: true }, _min: { price_per_hour: true } }),
      this.prisma.devices.findMany({ where: { branch_id: { in: ids }, deleted_at: null, operational_status: 'ACTIVE' }, select: { id: true, branch_id: true, type: true } }),
      this.prisma.booking_items.findMany({
        where: { branch_id: { in: ids }, active: true, start_at: { lte: new Date(now.getTime() + 15 * 60_000) }, blocked_until: { gt: now }, NOT: { booking: { status: 'PENDING_PAYMENT', hold_expires_at: { lte: now } } } },
        select: { device_id: true },
      }),
      this.prisma.sessions.findMany({ where: { branch_id: { in: ids }, status: { in: ['ACTIVE', 'PAUSED', 'WAITING'] } }, select: { device_id: true } }),
      this.prisma.branch_hours_exceptions.findMany({ where: { branch_id: { in: ids }, date: { gte: new Date(now.getTime() - 2 * 86400_000), lte: new Date(now.getTime() + 2 * 86400_000) } } }),
      this.prisma.bookings.groupBy({ by: ['branch_id'], where: { branch_id: { in: ids }, created_at: { gte: new Date(now.getTime() - 30 * 86400_000) }, status: { in: ['CONFIRMED', 'CHECKED_IN', 'ACTIVE', 'COMPLETED'] } }, _count: true }),
    ]);
    const busy = new Set([...busyItems.map((i) => i.device_id), ...sessions.map((s) => s.device_id)]);
    const minPrice = new Map(prices.map((p) => [p.branch_id, p._min.price_per_hour]));
    const pop = new Map(popularity.map((p) => [p.branch_id, p._count]));
    return rows.map((r) => {
      const ds = devices.filter((d) => d.branch_id === r.id);
      const st = openState(r.working_hours, exceptions.filter((e) => e.branch_id === r.id), r.timezone, now);
      return {
        id: r.id, name: r.name, slug: r.slug, address: r.address, latitude: r.latitude, longitude: r.longitude, cover_url: r.cover_url,
        club: { id: r.club_id, name: r.club_name, slug: r.club_slug, logo_url: r.club_logo },
        club_name: r.club_name, amenities: r.amenities,
        rating_avg: Number(r.rating_avg), rating_count: r.rating_count,
        distance_m: r.distance_m === null ? null : Math.round(r.distance_m),
        is_open_now: st.is_open, open_until: st.open_until,
        min_price_per_hour: minPrice.get(r.id) ?? null,
        price_from: minPrice.get(r.id) ?? null,
        device_types: [...new Set(ds.map((d) => d.type))],
        total_devices: ds.length,
        available_devices_count: st.is_open ? ds.filter((d) => !busy.has(d.id)).length : 0,
        free_devices: st.is_open ? ds.filter((d) => !busy.has(d.id)).length : 0,
        popularity: pop.get(r.id) ?? 0,
      };
    });
  }

  private baseSql(lat?: number, lng?: number) {
    const dist = lat !== undefined && lng !== undefined ? Prisma.sql`ST_Distance(b.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)` : Prisma.sql`NULL::float`;
    return Prisma.sql`
      SELECT b.id, b.club_id, b.name, b.slug, b.address, b.latitude, b.longitude, b.cover_url, b.rating_avg, b.rating_count,
             b.working_hours, b.timezone, b.amenities, c.name AS club_name, c.slug AS club_slug, c.logo_url AS club_logo, ${dist} AS distance_m
      FROM branches b JOIN clubs c ON c.id = b.club_id AND c.status = 'ACTIVE' AND c.deleted_at IS NULL
      WHERE b.status = 'ACTIVE' AND b.deleted_at IS NULL`;
  }

  async search(q: SearchQuery) {
    const hasPoint = q.lat !== undefined && q.lng !== undefined;
    const conds: Prisma.Sql[] = [];
    if (q.q) conds.push(Prisma.sql`(b.name ILIKE ${'%' + q.q + '%'} OR c.name ILIKE ${'%' + q.q + '%'} OR b.address ILIKE ${'%' + q.q + '%'})`);
    if (hasPoint && q.radius) conds.push(Prisma.sql`ST_DWithin(b.location, ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography, ${q.radius})`);
    if (q.rating_min !== undefined) conds.push(Prisma.sql`b.rating_avg >= ${q.rating_min}`);
    if (q.amenities?.length) conds.push(Prisma.sql`(b.amenities || c.amenities) @> ${q.amenities}::text[]`);
    if (q.device_type) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM devices d WHERE d.branch_id = b.id AND d.deleted_at IS NULL AND d.type = ${q.device_type})`);
    const where = conds.length ? Prisma.sql` AND ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Row[]>`${this.baseSql(q.lat, q.lng)}${where} LIMIT 500`;
    let items = await this.enrich(rows);
    if (q.open_now) items = items.filter((i) => i.is_open_now);
    if (q.available_now) items = items.filter((i) => i.available_devices_count > 0);
    if (q.price_min !== undefined) items = items.filter((i) => i.min_price_per_hour !== null && i.min_price_per_hour >= BigInt(q.price_min!));
    if (q.price_max !== undefined) items = items.filter((i) => i.min_price_per_hour !== null && i.min_price_per_hour <= BigInt(q.price_max!));
    const sort = q.sort ?? (hasPoint ? 'distance' : 'rating');
    items.sort((a, b) => {
      if (sort === 'distance') return (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity);
      if (sort === 'price') return Number(a.min_price_per_hour ?? 1n << 60n) - Number(b.min_price_per_hour ?? 1n << 60n);
      if (sort === 'popularity') return b.popularity - a.popularity;
      return b.rating_avg - a.rating_avg || b.rating_count - a.rating_count;
    });
    const total = items.length;
    const page = items.slice((q.page - 1) * q.limit, q.page * q.limit);
    return new Paginated(page, { page: q.page, limit: q.limit, total });
  }

  async nearby(q: SearchQuery) {
    if (q.lat === undefined || q.lng === undefined) throw new AppException('VALIDATION_ERROR', 'lat and lng are required', {});
    return this.search({ ...q, radius: q.radius ?? 10_000, sort: 'distance' });
  }

  async map(q: MapQuery) {
    const [w, s, e, n] = q.bbox.split(',').map(Number);
    const rows = await this.prisma.$queryRaw<Row[]>`${this.baseSql()} AND b.longitude BETWEEN ${w} AND ${e} AND b.latitude BETWEEN ${s} AND ${n} LIMIT 300`;
    return this.enrich(rows);
  }

  async summary(id: string, lat?: number, lng?: number) {
    const rows = await this.prisma.$queryRaw<Row[]>`${this.baseSql(lat, lng)} AND b.id = ${id}::uuid`;
    if (!rows.length) throw new AppException('NOT_FOUND', 'Branch not found');
    return (await this.enrich(rows))[0];
  }
}
