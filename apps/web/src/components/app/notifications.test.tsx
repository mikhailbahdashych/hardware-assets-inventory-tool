import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DASHBOARD_ROUTES } from '@/test/api-stub';
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

const INBOX_ROUTES = {
  ...DASHBOARD_ROUTES,
  'GET /notifications': { body: { notifications: [HANDED, RETURNED], unreadCount: 1 } },
  'POST /notifications/read': { status: 204 },
};

describe('the inbox bell', () => {
  it('counts the unread on the bell itself', async () => {
    renderApp(INBOX_ROUTES, '/');
    expect(
      await screen.findByRole('button', { name: 'Notifications (1 unread)' }),
    ).toBeInTheDocument();
  });

  it('opens to the rendered sentences, and opening is reading', async () => {
    const api = renderApp(INBOX_ROUTES, '/');

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications (1 unread)' }));
    expect(
      await screen.findByText('You were handed AST-0042 · MacBook Pro 14'),
    ).toBeInTheDocument();
    expect(screen.getByText('AST-0007 · Dell U2723QE was checked in from you')).toBeInTheDocument();

    // The panel being open is what read it — no per-row bookkeeping to do.
    await waitFor(() => expect(api.called('POST /notifications/read')).toBeDefined());
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('says when there is nothing, and does not "read" an empty inbox', async () => {
    const api = renderApp(
      {
        ...INBOX_ROUTES,
        'GET /notifications': { body: { notifications: [], unreadCount: 0 } },
      },
      '/',
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(api.called('POST /notifications/read')).toBeUndefined();
  });
});
