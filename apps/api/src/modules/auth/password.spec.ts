import * as argon2 from 'argon2';
import { AppException } from '../../common/errors';
import { assertStrongPassword, generateTempPassword, hashPassword } from './password';

/** Parol siyosati va vaqtinchalik parol generatori (admin tomonidan tiklash). */
describe('password helpers', () => {
  it('temporary password: Xxxx-xxxx-xxxx, unambiguous alphabet, all classes, unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(() => assertStrongPassword(p)).not.toThrow();
      seen.add(p);
    }
    expect(seen.size).toBe(500);
  });

  it('rejects short and listed weak passwords', () => {
    for (const p of ['short', '12345678', 'Password', 'QWERTY123']) expect(() => assertStrongPassword(p)).toThrow(AppException);
    expect(() => assertStrongPassword('Good#Pass2026')).not.toThrow();
  });

  it('hashes with argon2id (never stores plaintext)', async () => {
    const h = await hashPassword('Good#Pass2026');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(h, 'Good#Pass2026')).toBe(true);
  });
});
