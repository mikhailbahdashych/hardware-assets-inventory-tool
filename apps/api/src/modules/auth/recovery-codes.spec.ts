import { generateRecoveryCodes, hashRecoveryCode, RECOVERY_CODE_COUNT } from './recovery-codes';

describe('recovery codes', () => {
  it('generates 10 unique codes in xxxxx-xxxxx format', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
    }
  });

  it('hashes deterministically as sha256 hex', () => {
    const [code] = generateRecoveryCodes();
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes case and surrounding whitespace before hashing', () => {
    expect(hashRecoveryCode('  AB1CD-EF2GH ')).toBe(hashRecoveryCode('ab1cd-ef2gh'));
  });

  it('different codes hash differently', () => {
    const [a, b] = generateRecoveryCodes();
    expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b));
  });
});
