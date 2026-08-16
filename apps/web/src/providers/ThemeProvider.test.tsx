import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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
