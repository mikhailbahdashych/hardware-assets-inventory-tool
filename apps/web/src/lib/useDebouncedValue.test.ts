import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('gives the first value straight away — a first paint waits for nothing', () => {
    const { result } = renderHook(() => useDebouncedValue('mac', 200));
    expect(result.current).toBe('mac');
  });

  it('holds a change back until the typing stops', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'm' },
    });

    rerender({ value: 'ma' });
    rerender({ value: 'mac' });
    expect(result.current).toBe('m');

    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe('m');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('mac');
  });

  it('forgets a pending value when the hook goes away', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: 'm' },
    });
    rerender({ value: 'mac' });
    unmount();
    // A timer firing into an unmounted component is the warning this prevents.
    expect(() => act(() => vi.advanceTimersByTime(500))).not.toThrow();
  });
});
