import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MEMBER, DASHBOARD, DASHBOARD_ROUTES } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

/** The card a widget lives in, once its data has arrived. Found by heading, so
 *  the customize modal's toggle of the same name is never mistaken for it. */
async function widget(title: string) {
  const heading = await screen.findByRole('heading', { name: title });
  return within(heading.closest('section') as HTMLElement);
}

describe('the dashboard header', () => {
  it('says what day it is and how much is tracked', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    expect(await screen.findByText(/· 13 assets tracked$/)).toBeInTheDocument();
  });
});

describe('the status counts', () => {
  it('draws a card per status, whatever the inventory holds', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    await screen.findByRole('button', { name: /Available 4/ });

    for (const [status, label, count] of [
      ['available', 'Available', 4],
      ['assigned', 'Assigned', 6],
      ['in_repair', 'In repair', 1],
      ['ordered', 'Ordered', 1],
      ['retired', 'Retired', 1],
      // Zero is a number worth showing: an empty status is information.
      ['lost_stolen', 'Lost/Stolen', 0],
    ] as const) {
      expect(
        screen.getByRole('button', { name: `${label} ${count}` }),
        `card for ${status}`,
      ).toBeInTheDocument();
    }
  });

  it('draws a tile for a status this workspace invented, in the payload order', async () => {
    // The tiles are whatever the workspace has, in the workspace's order — the
    // page carries no list of its own to fall out of date.
    renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /dashboard': {
          body: {
            ...DASHBOARD,
            statusCounts: [
              { id: 'on_loan', label: 'On loan', color: 'info', count: 2 },
              ...DASHBOARD.statusCounts,
            ],
          },
        },
      },
      '/dashboard',
    );

    const first = await screen.findByRole('button', { name: 'On loan 2' });
    expect(first).toBeInTheDocument();
    await userEvent.click(first);
    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
  });

  it('clicks through to the assets list, already filtered', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: 'In repair 1' }));

    expect(await screen.findByRole('heading', { name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In repair 1' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });
});

describe('the widget cards', () => {
  it('shows the fleet composition with a bar per category', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const card = await widget('Assets by category');

    expect(card.getByText('Laptops')).toBeInTheDocument();
    // The bar is a meter, so its value is readable rather than only visible.
    expect(card.getByRole('meter', { name: 'Laptops' })).toHaveAttribute('aria-valuenow', '6');
    expect(card.getByRole('meter', { name: 'Desktops' })).toHaveAttribute('aria-valuenow', '1');
  });

  it('renders recent activity as sentences, and links to the full log', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const card = await widget('Recent activity');

    expect(card.getByText(/Assigned MacBook Pro 14" to Maya Lindqvist/)).toBeInTheDocument();
    // Two of the three events are theirs, which is why this counts.
    expect(card.getAllByText(/Tomasz Kowalski/)).toHaveLength(2);
    expect(card.getByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/activity');
  });

  it('colours a warranty by how soon it runs out, and opens the asset', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const card = await widget('Warranty expirations');

    // Under 30 days is an error colour; 30–90 is a warning.
    expect(card.getByText('26 days')).toHaveAttribute('data-sv', 'err');
    expect(card.getByText('61 days')).toHaveAttribute('data-sv', 'warn');

    await userEvent.click(card.getByRole('button', { name: /MacBook Pro 14"/ }));
    expect(await screen.findByRole('heading', { name: 'MacBook Pro 14"' })).toBeInTheDocument();
  });

  it('names who owes what back, and says where the list comes from', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const card = await widget('Pending returns');

    expect(card.getByText('MacBook Pro 14"')).toBeInTheDocument();
    expect(card.getByText('Maya Lindqvist')).toBeInTheDocument();
    expect(card.getByText(/due Aug 24, 2026/)).toBeInTheDocument();
    expect(card.getByText(/Triggered by offboarding/)).toBeInTheDocument();
  });

  it('says so when a widget has nothing in it', async () => {
    renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /dashboard': {
          body: { ...DASHBOARD, warrantyExpirations: [], pendingReturns: [] },
        },
      },
      '/dashboard',
    );
    expect(await screen.findByText(/No warranties expire in the next 90 days/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is due back/)).toBeInTheDocument();
  });
});

describe('customizing the dashboard', () => {
  it('hides a widget live and remembers it for this member', async () => {
    const api = renderApp(
      {
        ...DASHBOARD_ROUTES,
        'PATCH /me/prefs': {
          body: { member: { ...ADMIN_MEMBER, widgets: { warranty: false } } },
        },
      },
      '/dashboard',
    );

    await screen.findByRole('heading', { name: 'Warranty expirations' });
    await userEvent.click(screen.getByRole('button', { name: /customize widgets/i }));
    await userEvent.click(screen.getByRole('switch', { name: 'Warranty expirations' }));

    await waitFor(() => expect(api.called('PATCH /me/prefs')).toBeDefined());
    expect(api.called('PATCH /me/prefs')!.body).toEqual({ widgets: { warranty: false } });
    // Applied live: the response is written into the cache, no refetch. The
    // modal is still open, so the card is what has to be gone — not the name,
    // which its own toggle still carries.
    expect(screen.queryByRole('heading', { name: 'Warranty expirations' })).toBeNull();
  });

  it('treats a widget nobody has toggled as visible', async () => {
    renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /auth/me': { body: { member: { ...ADMIN_MEMBER, widgets: { kpi: false } } } },
      },
      '/dashboard',
    );

    // Only the one that was turned off is missing.
    expect(await screen.findByRole('heading', { name: 'Assets by category' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pending returns' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Available 4' })).toBeNull();
  });
});
