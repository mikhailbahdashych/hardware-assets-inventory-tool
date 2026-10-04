import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, MalformedApiResponse } from '@/api/client';
import { MetaUnanswered } from '@/api/queries';
import { AppErrorBoundary } from './AppErrorBoundary';

afterEach(() => {
  vi.restoreAllMocks();
});

function renderThrowing(error: unknown) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Throws(): never {
    throw error;
  }
  render(
    <AppErrorBoundary>
      <Throws />
    </AppErrorBoundary>,
  );
  return screen.getByRole('alert');
}

const LOGS_HINT = /Check the container logs/;

describe('AppErrorBoundary', () => {
  it('reads a request nothing answered as the app failing to start', () => {
    const alert = renderThrowing(new HttpError(502));
    expect(alert).toHaveTextContent('Inventory could not start');
    expect(alert).toHaveTextContent('The request failed with HTTP 502.');
    expect(alert).toHaveTextContent(LOGS_HINT);
  });

  it('reads a response that broke the contract the same way', () => {
    const alert = renderThrowing(new MalformedApiResponse('Expected JSON, got text/html.'));
    expect(alert).toHaveTextContent('Inventory could not start');
    expect(alert).toHaveTextContent(LOGS_HINT);
  });

  it('reads /meta never answering as the app failing to start, whatever the fetch threw', () => {
    // A refused connection rejects fetch with a bare TypeError — the same class
    // a renderer throws — so it is the router's own throw that says "startup".
    const alert = renderThrowing(new MetaUnanswered(new TypeError('Failed to fetch')));
    expect(alert).toHaveTextContent('Inventory could not start');
    expect(alert).toHaveTextContent('GET /api/v1/meta has not answered');
    expect(alert).toHaveTextContent(LOGS_HINT);
  });

  it('does not blame the server for a screen that threw while drawing', () => {
    // The app started and the server answered 200; a renderer choked on a row.
    const alert = renderThrowing(new RangeError('Invalid time value'));
    expect(alert).not.toHaveTextContent('could not start');
    expect(alert).toHaveTextContent('Inventory could not draw this screen');
    expect(alert).toHaveTextContent('Invalid time value');
    expect(alert).not.toHaveTextContent(LOGS_HINT);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
