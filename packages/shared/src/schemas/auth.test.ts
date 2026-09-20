import { describe, expect, it } from 'vitest';
import {
  acceptInviteInput,
  loginInput,
  prefsPatchInput,
  resetPasswordInput,
  setupInput,
} from './auth.js';

describe('setupInput', () => {
  it('accepts a valid payload and lowercases the email', () => {
    const parsed = setupInput.parse({
      orgName: 'Acme Corp',
      name: 'Tomasz Kowalski',
      email: 'Tomasz.Kowalski@Acme.io',
      password: 'Correct-horse-battery1',
    });
    expect(parsed.email).toBe('tomasz.kowalski@acme.io');
  });

  it('rejects short passwords', () => {
    expect(
      setupInput.safeParse({
        orgName: 'Acme',
        name: 'T',
        email: 't@acme.io',
        password: 'Sh0rt!',
      }).success,
    ).toBe(false);
  });

  it('holds every password to the one rule: length, upper, lower, digit, special', () => {
    const attempt = (password: string) =>
      setupInput.safeParse({ orgName: 'Acme', name: 'T', email: 't@acme.io', password }).success;
    expect(attempt('Valid-pass-9x')).toBe(true);
    expect(attempt('valid-pass-9x')).toBe(false); // no upper-case letter
    expect(attempt('VALID-PASS-9X')).toBe(false); // no lower-case letter
    expect(attempt('Valid-pass-xy')).toBe(false); // no digit
    expect(attempt('ValidPass9xy')).toBe(false); // no special character
    // The message names all four requirements, because the field shows it.
    const failed = setupInput.safeParse({
      orgName: 'Acme',
      name: 'T',
      email: 't@acme.io',
      password: 'ValidPass9xy',
    });
    expect(failed.success).toBe(false);
    if (!failed.success) {
      expect(JSON.stringify(failed.error.issues)).toMatch(/special character/);
    }
  });

  it('rejects invalid emails and empty org names', () => {
    expect(
      setupInput.safeParse({
        orgName: '',
        name: 'T',
        email: 't@acme.io',
        password: 'Long-enough-password1',
      }).success,
    ).toBe(false);
    expect(
      setupInput.safeParse({
        orgName: 'Acme',
        name: 'T',
        email: 'not-an-email',
        password: 'Long-enough-password1',
      }).success,
    ).toBe(false);
  });
});

describe('loginInput', () => {
  it('accepts credentials and lowercases the email', () => {
    const parsed = loginInput.parse({ email: 'Maya@Acme.io', password: 'x' });
    expect(parsed.email).toBe('maya@acme.io');
  });

  it('rejects an empty password', () => {
    expect(loginInput.safeParse({ email: 'maya@acme.io', password: '' }).success).toBe(false);
  });
});

describe('resetPasswordInput / acceptInviteInput', () => {
  it('requires a token and a long-enough new password', () => {
    expect(
      resetPasswordInput.safeParse({ token: '', newPassword: 'Long-enough-password1' }).success,
    ).toBe(false);
    expect(resetPasswordInput.safeParse({ token: 'abc', newPassword: 'short' }).success).toBe(
      false,
    );
    expect(
      resetPasswordInput.safeParse({ token: 'abc', newPassword: 'Long-enough-password1' }).success,
    ).toBe(true);
  });

  it('accept-invite requires a display name', () => {
    expect(
      acceptInviteInput.safeParse({ token: 'abc', name: '', password: 'Long-enough-password1' })
        .success,
    ).toBe(false);
    expect(
      acceptInviteInput.safeParse({
        token: 'abc',
        name: 'Daniel Okafor',
        password: 'Long-enough-password1',
      }).success,
    ).toBe(true);
  });
});

describe('prefsPatchInput', () => {
  it('accepts partial preference updates', () => {
    expect(prefsPatchInput.safeParse({ theme: 'dark' }).success).toBe(true);
    expect(prefsPatchInput.safeParse({ density: 'compact' }).success).toBe(true);
    expect(prefsPatchInput.safeParse({ widgets: { kpi: false, cat: true } }).success).toBe(true);
    expect(prefsPatchInput.safeParse({}).success).toBe(true);
  });

  it('rejects unknown theme or density values', () => {
    expect(prefsPatchInput.safeParse({ theme: 'sepia' }).success).toBe(false);
    expect(prefsPatchInput.safeParse({ density: 'cozy' }).success).toBe(false);
  });
});
