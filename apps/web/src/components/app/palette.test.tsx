import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MEMBER, DASHBOARD_ROUTES, LAPTOP, MAYA } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

const openPalette = async () => {
  await screen.findByRole('navigation');
  await userEvent.keyboard('{Meta>}k{/Meta}');
  return screen.findByRole('dialog');
};

const search = () => screen.getByRole('combobox', { name: /search assets, people/i });

describe('opening and closing the palette', () => {
  it('opens on ⌘K from anywhere in the app', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    expect(await openPalette()).toBeInTheDocument();
  });

  it('opens on Ctrl-K too, for the people not on a Mac', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    await screen.findByRole('navigation');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens from the topbar search field, which is the same thing', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    await userEvent.click(await screen.findByRole('button', { name: /search assets, people/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    await openPalette();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('what the palette finds', () => {
  it('groups assets, people and actions, and says which is which', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();

    expect(await within(dialog).findByText('Assets')).toBeInTheDocument();
    expect(within(dialog).getByText('Employees')).toBeInTheDocument();
    expect(within(dialog).getByText('Actions')).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: /MacBook Pro 14"/ })).toHaveTextContent(
      'AST-0142 · Assigned',
    );
    expect(within(dialog).getByRole('option', { name: /Maya Lindqvist/ })).toHaveTextContent(
      'Product Designer · Design',
    );
  });

  it('filters as you type and leaves out the groups with nothing in them', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();
    await within(dialog).findByRole('option', { name: /MacBook Pro 14"/ });

    await userEvent.type(search(), 'maya');
    expect(within(dialog).getByRole('option', { name: /Maya Lindqvist/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /MacBook Pro 14"/ })).toBeNull();
    expect(within(dialog).queryByText('Assets')).toBeNull();
  });

  it('shows at most four of each so the list stays scannable', async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      ...LAPTOP,
      id: `asset-${index}`,
      assetTag: `AST-90${index}`,
      name: `Spare laptop ${index}`,
    }));
    renderApp({ ...DASHBOARD_ROUTES, 'GET /assets': { body: { assets: many } } }, '/dashboard');
    const dialog = await openPalette();

    await within(dialog).findByRole('option', { name: /Spare laptop 0/ });
    await userEvent.type(search(), 'spare');
    expect(within(dialog).getAllByRole('option')).toHaveLength(4);
  });

  it('names the query when nothing matches', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();
    await userEvent.type(search(), 'hovercraft');
    expect(await within(dialog).findByText(/No results for “hovercraft”/)).toBeInTheDocument();
  });
});

describe('the keyboard', () => {
  it('moves through the results and opens the highlighted one', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();
    await within(dialog).findByRole('option', { name: /MacBook Pro 14"/ });

    // The first result starts highlighted, so ↵ alone opens it.
    const options = within(dialog).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowDown}');
    expect(within(dialog).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowUp}');
    expect(within(dialog).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'MacBook Pro 14"' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wraps around rather than stopping at the ends', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();
    await within(dialog).findByRole('option', { name: /MacBook Pro 14"/ });

    const count = within(dialog).getAllByRole('option').length;
    await userEvent.keyboard('{ArrowUp}');
    expect(within(dialog).getAllByRole('option')[count - 1]).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('keeps the highlight inside the list as the results change', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();
    await within(dialog).findByRole('option', { name: /MacBook Pro 14"/ });

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    await userEvent.type(search(), 'maya');

    const options = within(dialog).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the actions', () => {
  it('offers what the role may actually do', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();

    await within(dialog).findByText('Actions');
    for (const action of [
      'New asset',
      'Add employee',
      'Invite member',
      'Import CSV',
      'Toggle theme',
      'Admin settings',
    ]) {
      expect(within(dialog).getByRole('option', { name: new RegExp(action) })).toBeInTheDocument();
    }
  });

  it('offers a viewer only the ones that change nothing', async () => {
    renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /auth/me': { body: { member: { ...ADMIN_MEMBER, role: 'viewer' } } },
      },
      '/dashboard',
    );
    const dialog = await openPalette();

    await within(dialog).findByText('Actions');
    expect(within(dialog).getByRole('option', { name: /Toggle theme/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /New asset/ })).toBeNull();
    expect(within(dialog).queryByRole('option', { name: /Invite member/ })).toBeNull();
    expect(within(dialog).queryByRole('option', { name: /Admin settings/ })).toBeNull();
  });

  it('opens the modal an action names', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();
    await userEvent.click(await within(dialog).findByRole('option', { name: /New asset/ }));

    expect(await screen.findByRole('dialog', { name: /new asset/i })).toBeInTheDocument();
  });

  it('goes to a person straight from the palette', async () => {
    renderApp(DASHBOARD_ROUTES, '/dashboard');
    const dialog = await openPalette();
    await userEvent.click(
      await within(dialog).findByRole('option', { name: new RegExp(MAYA.displayName) }),
    );
    expect(await screen.findByRole('heading', { name: MAYA.displayName })).toBeInTheDocument();
  });
});
