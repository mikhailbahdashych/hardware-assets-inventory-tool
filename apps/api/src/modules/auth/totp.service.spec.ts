import * as OTPAuth from 'otpauth';
import { TotpService } from './totp.service';

function codeFor(secret: string, offsetMs = 0): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate({
    timestamp: Date.now() + offsetMs,
  });
}

describe('TotpService', () => {
  const service = new TotpService();

  it('generates a base32 secret', () => {
    const secret = service.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(service.generateSecret()).not.toBe(secret);
  });

  it('builds an otpauth URI carrying issuer and account label', () => {
    const uri = service.otpauthUri('user@example.com', 'JBSWY3DPEHPK3PXP');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=Software%20Inventory');
    expect(uri).toContain('user%40example.com');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });

  it('accepts the current code and one from the previous step (±1 window)', () => {
    const secret = service.generateSecret();
    expect(service.verify(codeFor(secret), secret)).toBe(true);
    expect(service.verify(codeFor(secret, -30_000), secret)).toBe(true);
  });

  it('rejects wrong codes and codes from three steps back', () => {
    const secret = service.generateSecret();
    expect(service.verify('000000', secret)).toBe(false);
    expect(service.verify(codeFor(secret, -90_000), secret)).toBe(false);
  });

  it('normalizes pasted whitespace in codes', () => {
    const secret = service.generateSecret();
    const code = codeFor(secret);
    expect(service.verify(`${code.slice(0, 3)} ${code.slice(3)}`, secret)).toBe(true);
    expect(service.verify(` ${code} `, secret)).toBe(true);
  });

  it('matches the RFC 6238 SHA-1 test vector (guards against library swaps)', () => {
    // Appendix B: secret "12345678901234567890", T=59s → 94287082 (6 digits: 287082)
    const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(rfcSecret) }).generate({
      timestamp: 59_000,
    });
    expect(code).toBe('287082');
  });

  it('validateStep returns the absolute time-step a code matched', () => {
    const secret = service.generateSecret();
    const nowStep = Math.floor(Date.now() / 30_000);
    expect(service.validateStep(codeFor(secret), secret)).toBe(nowStep);
    expect(service.validateStep(codeFor(secret, -30_000), secret)).toBe(nowStep - 1);
    expect(service.validateStep('000000', secret)).toBeNull();
  });

  it('rejects garbage tokens and secrets without throwing', () => {
    expect(service.verify('not-a-code', service.generateSecret())).toBe(false);
    expect(service.verify('', service.generateSecret())).toBe(false);
    expect(service.verify('123456', 'not-base32-!!!')).toBe(false);
  });
});
