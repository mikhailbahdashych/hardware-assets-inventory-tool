import { Injectable } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import { APP_NAME } from '@inventory/shared';

/** RFC 6238 defaults (SHA1/6 digits/30s); verification tolerates ±1 step. */
const WINDOW = 1;

@Injectable()
export class TotpService {
  generateSecret(): string {
    return new OTPAuth.Secret({ size: 20 }).base32;
  }

  otpauthUri(accountEmail: string, secret: string): string {
    return new OTPAuth.TOTP({
      issuer: APP_NAME,
      label: accountEmail,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).toString();
  }

  /**
   * Validates the code (current step ±1) and returns the absolute time-step
   * it matched, or null. Callers persist the step to reject replays.
   */
  validateStep(code: string, secret: string): number | null {
    try {
      const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
      const delta = totp.validate({ token: code.replace(/\s+/g, ''), window: WINDOW });
      if (delta === null) return null;
      return Math.floor(Date.now() / 30_000) + delta;
    } catch {
      return null;
    }
  }

  /** Accepts the current code or its immediate neighbors; never throws. */
  verify(code: string, secret: string): boolean {
    return this.validateStep(code, secret) !== null;
  }
}
