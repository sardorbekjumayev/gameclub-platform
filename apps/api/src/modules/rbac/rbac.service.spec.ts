import { Grant, RbacService } from './rbac.service';

const g = (p: Partial<Grant>): Grant => ({
  role: 'X', scope_type: 'CLUB', club_id: 'A', branch_id: null, permissions: ['devices.update'], ...p,
});

describe('RbacService.allows', () => {
  it('club admin of A cannot touch club B', () => {
    expect(RbacService.allows([g({})], 'devices.update', { club_id: 'A' })).toBe(true);
    expect(RbacService.allows([g({})], 'devices.update', { club_id: 'B' })).toBe(false);
  });
  it('branch scope limited to its branch', () => {
    const grants = [g({ scope_type: 'BRANCH', branch_id: 'b1' })];
    expect(RbacService.allows(grants, 'devices.update', { club_id: 'A', branch_id: 'b1' })).toBe(true);
    expect(RbacService.allows(grants, 'devices.update', { club_id: 'A', branch_id: 'b2' })).toBe(false);
    // klub-darajali marshrut: faqat o'z klubi
    expect(RbacService.allows(grants, 'devices.update', { club_id: 'A' })).toBe(true);
    expect(RbacService.allows(grants, 'devices.update', { club_id: 'B' })).toBe(false);
  });
  it('platform scope covers everything; missing permission denies', () => {
    expect(RbacService.allows([g({ scope_type: 'PLATFORM', club_id: null })], 'devices.update', { club_id: 'Z' })).toBe(true);
    expect(RbacService.allows([g({})], 'tariffs.update', { club_id: 'A' })).toBe(false);
  });
});
