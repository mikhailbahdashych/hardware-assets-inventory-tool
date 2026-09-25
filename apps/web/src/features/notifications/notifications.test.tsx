import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DASHBOARD_ROUTES, DB_DOWN, type StubRoutes } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

afterEach(resetAppState);

/** Two inbox rows as the API sends them: one unread, one already seen. */
const HANDED = {
  id: 'note-1',
  kind: 'assignment.received',
  params: { assetTag: 'AST-0042', assetName: 'MacBook Pro 14' },
  createdAt: '2026-08-17T08:00:00.000Z',
  readAt: null,
};
const RETURNED = {
  id: 'note-2',
  kind: 'assignment.checked_in',
  params: { assetTag: 'AST-0007', assetName: 'Dell U2723QE' },
  createdAt: '2026-08-15T08:00:00.000Z',
  readAt: '2026-08-16T08:00:00.000Z',
};

/** A stub whose inbox actually becomes read when the button posts. */
function inboxRoutes(): StubRoutes {
  let read = false;
  return {
    ...DASHBOARD_ROUTES,
    'GET /notifications': () => ({
      body: read
        ? {
            notifications: [{ ...HANDED, readAt: '2026-09-20T08:00:00.000Z' }, RETURNED],
            unreadCount: 0,
            total: 2,
          }
        : { notifications: [HANDED, RETURNED], unreadCount: 1, total: 2 },
    }),
    'POST /notifications/read': () => {
      read = true;
      return { status: 204 };
    },
  };
}

describe('the notifications page', () => {
  it('is where the bell leads, and opening it reads nothing by itself', async () => {
    const api = renderApp(inboxRoutes(), '/');

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();

    // Newest first, each a sentence with its time, the unread one marked.
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('You were handed AST-0042 · MacBook Pro 14');
    expect(rows[0]).toHaveAttribute('data-unread', 'true');
    expect(rows[1]).toHaveTextContent('AST-0007 · Dell U2723QE was checked in from you');
    expect(rows[1]).toHaveAttribute('data-unread', 'false');

    // Reading is a deliberate button now, not a side effect of looking.
    expect(api.called('POST /notifications/read')).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Notifications (1 unread)' })).toBeInTheDocument();
  });

  it('marks everything read on the button, and the badge follows', async () => {
    const api = renderApp(inboxRoutes(), '/notifications');

    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(api.called('POST /notifications/read')).toBeDefined());

    // The refetch brings the read rows and an empty badge back together.
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveAttribute('data-unread', 'false');
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  it('pages the history the way the activity log does — numbered, one page at a time', async () => {
    const api = renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /notifications?limit=50&offset=0': {
          body: { notifications: [HANDED], unreadCount: 0, total: 60 },
        },
        'GET /notifications?limit=50&offset=50': {
          body: { notifications: [RETURNED], unreadCount: 0, total: 60 },
        },
      },
      '/notifications',
    );

    expect(await screen.findByText(/60 notifications/)).toBeInTheDocument();
    expect(screen.getByText(/You were handed AST-0042/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '2' }));
    expect(await screen.findByText(/AST-0007 · Dell U2723QE was checked in/)).toBeInTheDocument();
    expect(
      api.calledAll('GET /notifications').some((call) => call.search === '?limit=50&offset=50'),
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('draws no page numbers when the whole inbox fits on one page', async () => {
    renderApp(inboxRoutes(), '/notifications');
    await screen.findByText(/2 notifications/);
    expect(screen.queryByRole('button', { name: '1' })).toBeNull();
    // The rows-per-page selector stays: it is the way to a smaller page.
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeInTheDocument();
  });

  it('says when there is nothing at all', async () => {
    renderApp(DASHBOARD_ROUTES, '/notifications');
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });
});

describe('a read that failed', () => {
  it('says so in the server’s own words instead of an empty inbox', async () => {
    renderApp({ ...DASHBOARD_ROUTES, 'GET /notifications': DB_DOWN }, '/notifications');

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText(/your notifications could not be loaded/i)).toBeInTheDocument();
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // The lie: a failed read drawn as an inbox with nothing waiting in it.
    expect(screen.queryByText(/all caught up/i)).toBeNull();
    expect(screen.queryByText(/notifications \u00b7 kept for 90 days/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).toBeNull();
  });

  it('reads the inbox again when the panel’s retry is pressed', async () => {
    let attempts = 0;
    const api = renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /notifications': () =>
          attempts++ === 0
            ? DB_DOWN
            : { body: { notifications: [HANDED], unreadCount: 1, total: 1 } },
      },
      '/notifications',
    );

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(/You were handed AST-0042/)).toBeInTheDocument();
    expect(api.calledAll('GET /notifications').length).toBeGreaterThan(1);
  });

  it('leaves nothing to mark read while the inbox is unreadable', async () => {
    renderApp({ ...DASHBOARD_ROUTES, 'GET /notifications': DB_DOWN }, '/notifications');

    await screen.findByRole('alert');
    // Zero unread is a fact about an inbox that answered. This one did not.
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });
});
