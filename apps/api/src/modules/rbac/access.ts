import { AppException } from '../../common/errors';
import type { Permission } from './catalog';
import { Grant, RbacService } from './rbac.service';

export interface Scope {
  club_id: string;
  branch_id?: string | null;
}

/**
 * Tenant scope yordamchilari (docs/01-API.md §5.2, CLAUDE.md qoida 4).
 * Boshqa klub resursi "mavjud emas" (404) deb qaytariladi — mavjudligini ham oshkor qilmaymiz.
 */
export function can(grants: Grant[], permission: Permission, scope: Scope): boolean {
  return RbacService.allows(grants, permission, { club_id: scope.club_id, branch_id: scope.branch_id ?? null });
}

export function assertCan(grants: Grant[], permission: Permission, scope: Scope): void {
  if (!can(grants, permission, scope)) throw new AppException('NOT_FOUND', 'Not found');
}

export interface ScopeFilter {
  platform: boolean;
  clubIds: string[];
  branchIds: string[];
}

/** Ro'yxat so'rovlari uchun: foydalanuvchi shu permission bilan qaysi klub/filiallarni ko'ra oladi. */
export function scopeFilter(grants: Grant[], permission: Permission): ScopeFilter {
  const f: ScopeFilter = { platform: false, clubIds: [], branchIds: [] };
  for (const g of grants) {
    if (!g.permissions.includes(permission)) continue;
    if (g.scope_type === 'PLATFORM') f.platform = true;
    else if (g.scope_type === 'CLUB' && g.club_id) f.clubIds.push(g.club_id);
    else if (g.scope_type === 'BRANCH' && g.branch_id) f.branchIds.push(g.branch_id);
  }
  return f;
}

/** Klub ichida foydalanuvchi ko'ra oladigan filiallar: null = klubning hammasi. */
export function branchesInClub(grants: Grant[], permission: Permission, clubId: string): string[] | null {
  const mine = grants.filter((g) => g.permissions.includes(permission));
  if (mine.some((g) => g.scope_type === 'PLATFORM' || (g.scope_type === 'CLUB' && g.club_id === clubId))) return null;
  return mine.filter((g) => g.scope_type === 'BRANCH' && g.club_id === clubId && g.branch_id).map((g) => g.branch_id!);
}

export const hasAnyScope = (f: ScopeFilter) => f.platform || f.clubIds.length > 0 || f.branchIds.length > 0;

/** Prisma `where` bo'lagi: `club_id` va `branch_id` ustunlari bor jadvallar uchun. */
export function scopeWhere(f: ScopeFilter): Record<string, unknown> {
  if (f.platform) return {};
  return { OR: [{ club_id: { in: f.clubIds } }, { branch_id: { in: f.branchIds } }] };
}

/** Faqat `club_id` ustuni bor jadvallar uchun (filial roli o'z klubini ko'radi). */
export function clubScopeWhere(f: ScopeFilter, grants: Grant[]): Record<string, unknown> {
  if (f.platform) return {};
  const branchClubIds = grants.filter((g) => g.scope_type === 'BRANCH' && g.club_id).map((g) => g.club_id!);
  return { club_id: { in: [...f.clubIds, ...branchClubIds] } };
}
