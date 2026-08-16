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
      password: 'correct-horse-battery',
    });
    expect(parsed.email).toBe('tomasz.kowalski@acme.io');
  });

  it('rejects short passwords', () => {
    expect(
      setupInput.safeParse({
        orgName: 'Acme',
        name: 'T',
        email: 't@acme.io',
        password: 'short',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid emails and empty org names', () => {
    expect(
      setupInput.safeParse({
        orgName: '',
        name: 'T',
        email: 't@acme.io',
        password: 'long-enough-password',
      }).success,
    ).toBe(false);
    expect(
      setupInput.safeParse({
        orgName: 'Acme',
        name: 'T',
        email: 'not-an-email',
        password: 'long-enough-password',
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
      resetPasswordInput.safeParse({ token: '', newPassword: 'long-enough-password' }).success,
    ).toBe(false);
    expect(resetPasswordInput.safeParse({ token: 'abc', newPassword: 'short' }).success).toBe(
      false,
    );
    expect(
      resetPasswordInput.safeParse({ token: 'abc', newPassword: 'long-enough-password' }).success,
    ).toBe(true);
  });

  it('accept-invite requires a display name', () => {
    expect(
      acceptInviteInput.safeParse({ token: 'abc', name: '', password: 'long-enough-password' })
        .success,
    ).toBe(false);
    expect(
      acceptInviteInput.safeParse({
        token: 'abc',
        name: 'Daniel Okafor',
        password: 'long-enough-password',
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
