import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { REQUIRED_PERMISSION } from '../../common/decorators/auth.decorators';
import { PERMISSIONS, SYSTEM_ROLES } from './catalog';

/** Permission katalogi yagona manba (CLAUDE.md qoida 8, docs/01-API.md §5.3). */

const SRC = join(__dirname, '..', '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const sources = walk(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
const catalog = new Set<string>(PERMISSIONS);
const role = (code: string) => {
  const r = SYSTEM_ROLES.find((x) => x.code === code);
  if (!r) throw new Error(`role ${code} missing`);
  return new Set<string>(r.permissions);
};

describe('RBAC catalog', () => {
  it('has unique, well-formed permission keys', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });

  it("every system role's permissions exist in the catalog (no duplicates)", () => {
    expect(new Set(SYSTEM_ROLES.map((r) => r.code)).size).toBe(SYSTEM_ROLES.length);
    for (const r of SYSTEM_ROLES) {
      for (const p of r.permissions) expect({ role: r.code, p, valid: catalog.has(p) }).toEqual({ role: r.code, p, valid: true });
      expect(new Set(r.permissions).size).toBe(r.permissions.length);
    }
  });

  it('role hierarchy: OPERATOR ⊂ BRANCH_ADMIN ⊂ CLUB_ADMIN ⊂ CLUB_OWNER ⊂ SUPER_ADMIN', () => {
    const chain = ['OPERATOR', 'BRANCH_ADMIN', 'CLUB_ADMIN', 'CLUB_OWNER', 'SUPER_ADMIN'].map(role);
    for (let i = 1; i < chain.length; i++) for (const p of chain[i - 1]) expect(chain[i].has(p)).toBe(true);
    expect(role('SUPER_ADMIN').size).toBe(PERMISSIONS.length);
  });

  it('club/branch roles never get platform.* permissions; SUPPORT and CUSTOMER are minimal', () => {
    for (const code of ['CLUB_OWNER', 'CLUB_ADMIN', 'BRANCH_ADMIN', 'OPERATOR']) {
      expect([...role(code)].filter((p) => p.startsWith('platform.'))).toEqual([]);
    }
    expect([...role('SUPPORT')].every((p) => p.startsWith('platform.'))).toBe(true);
    expect(role('SUPPORT').has('platform.settings.manage')).toBe(false);
    expect(role('CUSTOMER').size).toBe(0);
    // Club owner — klubdagi hamma permission (§5.3)
    expect(role('CLUB_OWNER').size).toBe(PERMISSIONS.filter((p) => !p.startsWith('platform.')).length);
  });

  it('documented defaults (§5.3 + rentals): key permissions per role', () => {
    const op = role('OPERATOR');
    for (const p of ['devices.view', 'devices.status.change', 'bookings.create', 'bookings.checkin', 'sessions.stop', 'payments.create', 'shifts.open', 'rentals.view', 'rentals.process']) expect(op.has(p)).toBe(true);
    for (const p of ['rentals.manage', 'reports.view', 'payments.refund', 'staff.create', 'promotions.view', 'reviews.reply']) expect(op.has(p)).toBe(false);
    const ba = role('BRANCH_ADMIN');
    for (const p of ['rooms.create', 'tariffs.update', 'reports.view', 'staff.view', 'promotions.view', 'rentals.manage']) expect(ba.has(p)).toBe(true);
    for (const p of ['reports.export', 'staff.create', 'promotions.manage', 'roles.manage']) expect(ba.has(p)).toBe(false);
    const ca = role('CLUB_ADMIN');
    for (const p of ['branches.update', 'staff.create', 'reports.export']) expect(ca.has(p)).toBe(true);
    expect(ca.has('roles.manage')).toBe(false);
    expect(role('CLUB_OWNER').has('roles.manage')).toBe(true);
  });

  it('scope types match role level', () => {
    const scope = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.code, r.scope_type]));
    expect(scope).toMatchObject({ SUPER_ADMIN: 'PLATFORM', SUPPORT: 'PLATFORM', CLUB_OWNER: 'CLUB', CLUB_ADMIN: 'CLUB', BRANCH_ADMIN: 'BRANCH', OPERATOR: 'BRANCH' });
  });
});

describe('Permission usage in code', () => {
  it('every @RequirePermission key in controller source exists in catalog.ts', () => {
    const found: { file: string; key: string }[] = [];
    for (const f of sources) {
      for (const m of readFileSync(f, 'utf8').matchAll(/@RequirePermission\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) found.push({ file: f.replace(SRC, 'src'), key: m[1] });
    }
    expect(found.length).toBeGreaterThan(50);
    expect(found.filter((x) => !catalog.has(x.key))).toEqual([]);
  });

  it('runtime metadata of every controller handler uses catalog keys', () => {
    const controllers = sources.filter((f) => f.endsWith('.controller.ts'));
    let checked = 0;
    const unknown: string[] = [];
    for (const f of controllers) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(f) as Record<string, unknown>;
      for (const exp of Object.values(mod)) {
        if (typeof exp !== 'function' || !exp.prototype) continue;
        const keys = [Reflect.getMetadata(REQUIRED_PERMISSION, exp)];
        for (const name of Object.getOwnPropertyNames(exp.prototype)) {
          const fn = Object.getOwnPropertyDescriptor(exp.prototype, name)?.value;
          if (typeof fn === 'function') keys.push(Reflect.getMetadata(REQUIRED_PERMISSION, fn));
        }
        for (const k of keys.filter((x): x is string => typeof x === 'string')) {
          checked++;
          if (!catalog.has(k)) unknown.push(`${exp.name}: ${k}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(unknown).toEqual([]);
  });

  it('permission string literals passed to scope helpers exist in catalog.ts', () => {
    const calls = /\b(?:assertCan|can|scopeFilter|branchesInClub|allows)\([^)]*?['"`]([a-z_]+(?:\.[a-z_]+)+)['"`]/g;
    const loads = /\.load(?:For)?\([^)]*?,\s*['"`]([a-z_]+(?:\.[a-z_]+)+)['"`]\s*\)/g;
    const includes = /permissions\.includes\(\s*['"`]([a-z_]+(?:\.[a-z_]+)+)['"`]/g;
    const bad: string[] = [];
    let n = 0;
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      for (const re of [calls, loads, includes]) {
        for (const m of text.matchAll(re)) {
          n++;
          if (!catalog.has(m[1])) bad.push(`${f.replace(SRC, 'src')}: ${m[1]}`);
        }
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
