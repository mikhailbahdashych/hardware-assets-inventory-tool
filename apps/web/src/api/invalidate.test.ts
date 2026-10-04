import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateInventory } from './invalidate';

describe('invalidateInventory', () => {
  it('refreshes the activity log and the members list, which inventory writes change too', () => {
    const client = new QueryClient();
    // Every inventory write is audited, and a member row names its linked employee.
    for (const key of [
      ['audit', { limit: 50 }],
      ['members', { limit: 50 }],
    ]) {
      client.setQueryData(key, {});
    }
    invalidateInventory(client);
    expect(client.getQueryState(['audit', { limit: 50 }])!.isInvalidated).toBe(true);
    expect(client.getQueryState(['members', { limit: 50 }])!.isInvalidated).toBe(true);
  });
});
