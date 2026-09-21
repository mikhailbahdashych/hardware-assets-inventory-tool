import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePageSize } from './usePageSize';

afterEach(() => {
  // Unstub first: the blocked-storage double has no clear() to call.
  vi.unstubAllGlobals();
  // A remembered size outlives a render, exactly like the theme does.
  window.localStorage.clear();
});

describe('usePageSize', () => {
  it('starts at the surface default and remembers what is chosen instead', () => {
    const { result } = renderHook(() => usePageSize('assets', 50));
    expect(result.current[0]).toBe(50);

    act(() => result.current[1](10));
    expect(result.current[0]).toBe(10);
    expect(window.localStorage.getItem('inv.rowsPerPage.assets')).toBe('10');
  });

  it('reads the choice back on the next visit, per surface', () => {
    window.localStorage.setItem('inv.rowsPerPage.assets', '25');
    expect(renderHook(() => usePageSize('assets', 50)).result.current[0]).toBe(25);
    // Another list's key is another list's business.
    expect(renderHook(() => usePageSize('employees', 50)).result.current[0]).toBe(50);
  });

  it('falls back when the stored value is not one of the sizes offered', () => {
    for (const stored of ['', 'lots', '37', '-10']) {
      window.localStorage.setItem('inv.rowsPerPage.members', stored);
      expect(renderHook(() => usePageSize('members', 50)).result.current[0]).toBe(50);
    }
  });

  it('falls back rather than crashing when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('The operation is insecure.');
      },
      setItem: () => {
        throw new Error('The operation is insecure.');
      },
    });

    const { result } = renderHook(() => usePageSize('activity', 200));
    expect(result.current[0]).toBe(200);
    // The choice still holds for this visit; only its persistence is lost.
    act(() => result.current[1](25));
    expect(result.current[0]).toBe(25);
  });
});
