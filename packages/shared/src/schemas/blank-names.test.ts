import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { assetCreateInput } from './assets.js';
import { acceptInviteInput, setupInput } from './auth.js';
import { customFieldCreateInput } from './custom-fields.js';
import { employeeCreateInput } from './employees.js';
import { settingsPatchInput } from './settings.js';

// A blank name reaches a person as the field's message, and zod's own —
// "Too small: expected string to have >=1 characters" — is not a sentence
// anybody filling in a form should have to decode.

function messageFor(schema: z.ZodType, input: unknown, field: string): string | undefined {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe('a blank name', () => {
  it.each([
    [
      'an asset',
      assetCreateInput,
      { name: '  ', category: 'laptops', status: 'available' },
      'name',
      'Give the asset a name.',
    ],
    [
      'accepting an invitation',
      acceptInviteInput,
      { token: 'abc', name: '', password: 'Long-enough-password1!' },
      'name',
      'Enter your name.',
    ],
    [
      'setup',
      setupInput,
      { orgName: 'Acme', name: '', email: 'a@acme.io', password: 'Long-enough-password1!' },
      'name',
      'Enter your name.',
    ],
    [
      'the workspace at setup',
      setupInput,
      { orgName: ' ', name: 'Tomasz', email: 'a@acme.io', password: 'Long-enough-password1!' },
      'orgName',
      'Give the workspace a name.',
    ],
    [
      'the workspace in settings',
      settingsPatchInput,
      { orgName: '' },
      'orgName',
      'Give the workspace a name.',
    ],
    [
      'an employee',
      employeeCreateInput,
      { firstName: '', lastName: 'Chen', email: 'g@acme.io' },
      'firstName',
      'Enter a name.',
    ],
    [
      'a custom field',
      customFieldCreateInput,
      { label: '', type: 'text' },
      'label',
      'Give the field a name.',
    ],
  ])('is refused in words for %s', (_what, schema, input, field, message) => {
    expect(messageFor(schema, input, field)).toBe(message);
  });
});
