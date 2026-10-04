import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';

function Demo() {
  const { theme, density, toggleTheme, setDensity } = useTheme();
  return (
    <div>
      <span data-testid="state">{`${theme}/${density}`}</span>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
      <button type="button" onClick={() => setDensity('compact')}>
        compact
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.density;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps working when the browser refuses to store anything', () => {
    // Private mode, blocked site data, a full quota: setItem throws.
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    render(
      <ThemeProvider>
        <Demo />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('toggle'));
    fireEvent.click(screen.getByText('compact'));
    expect(screen.getByTestId('state')).toHaveTextContent('dark/compact');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('adopts the pre-paint values from the html element', () => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.density = 'compact';
    render(
      <ThemeProvider>
        <Demo />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('state')).toHaveTextContent('dark/compact');
  });

  it('toggling the theme updates the html attribute and localStorage', () => {
    render(
      <ThemeProvider>
        <Demo />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('toggle'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('inv.theme')).toBe('dark');
    fireEvent.click(screen.getByText('toggle'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('inv.theme')).toBe('light');
  });

  it('changing density updates the html attribute and localStorage', () => {
    render(
      <ThemeProvider>
        <Demo />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('compact'));
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(window.localStorage.getItem('inv.density')).toBe('compact');
  });
});
