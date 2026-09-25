import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEMBER,
  assetsRoute,
  DB_DOWN,
  INVENTORY_ROUTES,
  LAPTOP,
  LAPTOP_DETAIL,
  MONITOR,
  READY_META,
  session,
  VIEWER_ACTIONS,
  WORKFLOW,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

const viewerRoutes = {
  ...INVENTORY_ROUTES,
  'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'viewer' }, VIEWER_ACTIONS),
};

async function rows() {
  const table = await screen.findByRole('table');
  return within(table)
    .getAllByRole('row')
    .filter((row) => row.dataset.clickable === 'true');
}

describe('asset list', () => {
  it('shows each asset with its tag, status and holder', async () => {
    renderApp(INVENTORY_ROUTES, '/assets');

    expect(await screen.findByText('MacBook Pro 14"')).toBeInTheDocument();
    expect(screen.getByText('AST-0142')).toBeInTheDocument();
    expect(screen.getByText('C02XK1AZQ6L7')).toBeInTheDocument();
    expect(screen.getByText('Maya Lindqvist')).toBeInTheDocument();
    expect(screen.getByText('In repair')).toBeInTheDocument();
    expect(screen.getByText('2 assets')).toBeInTheDocument();
  });

  it('draws each status in the words the workspace chose', async () => {
    // Statuses are rows an admin edits, so the pill reads the workflow rather
    // than a label map compiled into the bundle.
    renderApp(
      {
        ...INVENTORY_ROUTES,
        'GET /workflow': {
          body: {
            ...WORKFLOW,
            statuses: WORKFLOW.statuses.map((status) =>
              status.id === 'in_repair' ? { ...status, label: 'At the shop' } : status,
            ),
          },
        },
      },
      '/assets',
    );

    expect(await screen.findByText('At the shop')).toBeInTheDocument();
    expect(screen.queryByText('In repair')).toBeNull();
    expect(screen.getByRole('button', { name: 'At the shop 1' })).toBeInTheDocument();
  });

  it('filters live by text and records the query in the URL', async () => {
    const api = renderApp(INVENTORY_ROUTES, '/assets');
    await screen.findByText('MacBook Pro 14"');

    await userEvent.type(screen.getByLabelText(/filter assets/i), 'dell');
    await waitFor(() => expect(screen.queryByText('MacBook Pro 14"')).toBeNull());
    expect(screen.getByText('Dell U2723QE')).toBeInTheDocument();
    expect(screen.getByText('1 asset')).toBeInTheDocument();
    // The matching is the server's: the needle rides in the request, and the
    // debounce means the word is one query rather than four.
    const searches = api.calledAll('GET /assets').map((call) => call.search);
    expect(searches.at(-1)).toContain('q=dell');
    expect(searches).toHaveLength(2);
  });

  it('asks for one page at a time and pages through the rest', async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...LAPTOP,
      id: `asset-${index}`,
      assetTag: `AST-9${String(index).padStart(3, '0')}`,
      name: `Spare laptop ${index}`,
    }));
    const api = renderApp({ ...INVENTORY_ROUTES, 'GET /assets': assetsRoute(many) }, '/assets');
    await screen.findByText('Spare laptop 0');

    expect(await rows()).toHaveLength(50);
    expect(screen.getByText('120 assets')).toBeInTheDocument();
    expect(api.called('GET /assets')!.search).toContain('limit=50');

    await userEvent.click(screen.getByRole('button', { name: '3' }));
    await waitFor(() => expect(screen.getByText('Spare laptop 100')).toBeInTheDocument());
    expect(api.calledAll('GET /assets').at(-1)!.search).toContain('offset=100');
  });

  it('pages by the size the selector was left on, and remembers it', async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...LAPTOP,
      id: `asset-${index}`,
      assetTag: `AST-9${String(index).padStart(3, '0')}`,
      name: `Spare laptop ${index}`,
    }));
    const routes = { ...INVENTORY_ROUTES, 'GET /assets': assetsRoute(many) };
    const api = renderApp(routes, '/assets');
    await screen.findByText('Spare laptop 0');
    expect(await rows()).toHaveLength(50);

    await choose(screen, 'Rows per page', '10');
    await waitFor(() => expect(api.calledAll('GET /assets').at(-1)!.search).toContain('limit=10'));
    // A smaller page is a different list; page three of it is not where
    // anybody meant to land.
    expect(api.calledAll('GET /assets').at(-1)!.search).toContain('offset=0');
    await waitFor(async () => expect(await rows()).toHaveLength(10));
    // 120 rows, ten to a page.
    expect(screen.getByRole('button', { name: '12' })).toBeInTheDocument();

    cleanup();
    const second = renderApp(routes, '/assets');
    await screen.findByText('Spare laptop 0');
    expect(second.called('GET /assets')!.search).toContain('limit=10');
    expect(await rows()).toHaveLength(10);
  });

  it('counts and pages the filtered rows, not the whole search', async () => {
    // 60 under the search, 10 under the pill: with a page size of 50 the
    // unfiltered list has two pages and the filtered one has none at all.
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...LAPTOP,
      id: `asset-${index}`,
      assetTag: `AST-9${String(index).padStart(3, '0')}`,
      name: `Spare laptop ${index}`,
      status: index < 10 ? 'in_repair' : 'available',
    }));
    renderApp({ ...INVENTORY_ROUTES, 'GET /assets': assetsRoute(many) }, '/assets');
    await screen.findByText('Spare laptop 0');

    expect(screen.getByText('60 assets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'In repair 10' }));
    await waitFor(() => expect(screen.getByText('10 assets')).toBeInTheDocument());
    expect(await rows()).toHaveLength(10);
    // One page of ten needs no numbers at all — and must never offer a second.
    // The rows-per-page selector stays: it is the way back to a smaller page.
    expect(screen.queryByRole('button', { name: '2' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toBeInTheDocument();
    // The pills still describe the whole search, which is the other master.
    expect(screen.getByRole('button', { name: 'All 60' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Available 50' })).toBeInTheDocument();
  });

  it('goes back to page one when the filter changes under it', async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...LAPTOP,
      id: `asset-${index}`,
      assetTag: `AST-9${String(index).padStart(3, '0')}`,
      name: `Spare laptop ${index}`,
      status: index === 119 ? 'in_repair' : 'available',
    }));
    const api = renderApp({ ...INVENTORY_ROUTES, 'GET /assets': assetsRoute(many) }, '/assets');
    await screen.findByText('Spare laptop 0');

    await userEvent.click(screen.getByRole('button', { name: '3' }));
    await waitFor(() =>
      expect(api.calledAll('GET /assets').at(-1)!.search).toContain('offset=100'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'In repair 1' }));
    await waitFor(() =>
      expect(api.calledAll('GET /assets').at(-1)!.search).toContain('status=in_repair'),
    );
    // Page three of a one-page list is not where anybody meant to land.
    expect(api.calledAll('GET /assets').at(-1)!.search).toContain('offset=0');
  });

  it('filters by status pill, counting the whole inventory', async () => {
    renderApp(INVENTORY_ROUTES, '/assets');
    await screen.findByText('MacBook Pro 14"');

    expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retired 0' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'In repair 1' }));
    await waitFor(() => expect(screen.queryByText('MacBook Pro 14"')).toBeNull());
    // The counts still describe the inventory, not the filtered view.
    expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument();
  });

  it('starts from the filter in the URL, so a filtered view is shareable', async () => {
    renderApp(INVENTORY_ROUTES, '/assets?status=in_repair');
    expect(await screen.findByText('Dell U2723QE')).toBeInTheDocument();
    expect(screen.queryByText('MacBook Pro 14"')).toBeNull();
  });

  it('says so when nothing matches, and when there is nothing at all', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /assets': assetsRoute([]) }, '/assets');
    expect(await screen.findByText(/no assets yet/i)).toBeInTheDocument();
  });

  it('opens the asset when its row is clicked', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /assets/asset-1': { body: LAPTOP_DETAIL } }, '/assets');
    await screen.findByText('MacBook Pro 14"');

    await userEvent.click((await rows())[0]!);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('offers no mutation affordances to a viewer', async () => {
    renderApp(viewerRoutes, '/assets');
    await screen.findByText('MacBook Pro 14"');
    expect(screen.queryByRole('button', { name: /new asset/i })).toBeNull();
  });
});

describe('creating an asset', () => {
  it('prefills the suggested tag and posts what the form holds', async () => {
    const api = renderApp(
      { ...INVENTORY_ROUTES, 'POST /assets': { body: { asset: { ...MONITOR, id: 'asset-3' } } } },
      '/assets',
    );
    await screen.findByText('MacBook Pro 14"');

    await userEvent.click(screen.getByRole('button', { name: /new asset/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getByLabelText(/asset tag/i)).toHaveValue('AST-0144'));

    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'ThinkPad X1');
    await choose(within(dialog), /category/i, 'Desktops');
    await userEvent.type(within(dialog).getByLabelText(/purchase price/i), '1,299.00');
    await userEvent.click(within(dialog).getByLabelText('MDM enrolled'));
    await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

    await waitFor(() => expect(api.called('POST /assets')).toBeDefined());
    expect(api.called('POST /assets')!.body).toMatchObject({
      name: 'ThinkPad X1',
      category: 'desktops',
      status: 'available',
      assetTag: 'AST-0144',
      purchasePriceCents: 129900,
      customValues: { mdm_enrolled: 'true', hostname: null },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('rejects a price it cannot read before sending anything', async () => {
    const api = renderApp(INVENTORY_ROUTES, '/assets');
    await screen.findByText('MacBook Pro 14"');

    await userEvent.click(screen.getByRole('button', { name: /new asset/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'ThinkPad X1');
    await userEvent.type(within(dialog).getByLabelText(/purchase price/i), 'free');
    await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

    expect(await within(dialog).findByText(/enter an amount/i)).toBeInTheDocument();
    expect(api.called('POST /assets')).toBeUndefined();
  });

  it('puts a server field error under its input', async () => {
    renderApp(
      {
        ...INVENTORY_ROUTES,
        'POST /assets': {
          status: 422,
          body: {
            error: {
              code: 'validation',
              message: 'Please correct the highlighted fields.',
              fields: { assetTag: 'That asset tag is already in use.' },
            },
          },
        },
      },
      '/assets',
    );
    await screen.findByText('MacBook Pro 14"');

    await userEvent.click(screen.getByRole('button', { name: /new asset/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'ThinkPad X1');
    await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

    expect(await within(dialog).findByText(/already in use/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the modal open and clears the form when "Create another" is ticked', async () => {
    renderApp(
      { ...INVENTORY_ROUTES, 'POST /assets': { body: { asset: { ...MONITOR, id: 'asset-3' } } } },
      '/assets',
    );
    await screen.findByText('MacBook Pro 14"');

    await userEvent.click(screen.getByRole('button', { name: /new asset/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'ThinkPad X1');
    await userEvent.click(within(dialog).getByLabelText(/create another/i));
    await userEvent.click(screen.getByRole('button', { name: /create asset/i }));

    await waitFor(() => expect(within(dialog).getByLabelText(/^name/i)).toHaveValue(''));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks who holds an asset that starts out assigned', async () => {
    renderApp(INVENTORY_ROUTES, '/assets');
    await screen.findByText('MacBook Pro 14"');

    await userEvent.click(screen.getByRole('button', { name: /new asset/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/assigned to/i)).toBeNull();

    await choose(within(dialog), /status/i, 'Assigned');
    const holder = await within(dialog).findByRole('combobox', { name: /assigned to/i });
    await userEvent.click(holder);
    expect(screen.getByRole('option', { name: 'Maya Lindqvist' })).toBeInTheDocument();
  });
});

describe('asset detail', () => {
  const detailRoutes = { ...INVENTORY_ROUTES, 'GET /assets/asset-1': { body: LAPTOP_DETAIL } };

  it('shows the record, its custom fields and who holds it', async () => {
    renderApp(detailRoutes, '/assets/asset-1');

    expect(await screen.findByRole('heading', { name: 'MacBook Pro 14"' })).toBeInTheDocument();
    expect(screen.getByText('AST-0142 · C02XK1AZQ6L7')).toBeInTheDocument();
    expect(screen.getByText('€2,340')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('maya-mbp')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /maya lindqvist/i })).toHaveAttribute(
      'href',
      '/employees/emp-1',
    );
  });

  it('names the asset in the breadcrumb', async () => {
    renderApp(detailRoutes, '/assets/asset-1');
    expect(await screen.findByText('Assets / AST-0142')).toBeInTheDocument();
  });

  it('saves an edit without offering to reassign the asset', async () => {
    const api = renderApp(
      { ...detailRoutes, 'PATCH /assets/asset-1': { body: { asset: LAPTOP } } },
      '/assets/asset-1',
    );
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/assigned to/i)).toBeNull();
    // An assigned asset cannot be moved out of that status from here.
    expect(within(dialog).getByLabelText(/status/i)).toBeDisabled();

    await userEvent.clear(within(dialog).getByLabelText(/supplier/i));
    await userEvent.type(within(dialog).getByLabelText(/supplier/i), 'Dustin');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.called('PATCH /assets/asset-1')).toBeDefined());
    expect(api.called('PATCH /assets/asset-1')!.body).toMatchObject({ supplier: 'Dustin' });
  });

  it('deletes only after a confirmation press, then returns to the list', async () => {
    const api = renderApp(
      { ...detailRoutes, 'DELETE /assets/asset-1': { status: 204 } },
      '/assets/asset-1',
    );
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

    await userEvent.click(await screen.findByRole('button', { name: /delete asset/i }));
    expect(api.called('DELETE /assets/asset-1')).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
    await waitFor(() => expect(api.called('DELETE /assets/asset-1')).toBeDefined());
    expect(await screen.findByRole('button', { name: /new asset/i })).toBeInTheDocument();
  });

  it('gives a viewer no way to edit', async () => {
    renderApp({ ...detailRoutes, ...viewerRoutes }, '/assets/asset-1');
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('meta', () => {
  it('keeps the shell reachable when the inventory call fails', async () => {
    renderApp(
      {
        'GET /meta': { body: READY_META },
        'GET /auth/me': session(),
        'GET /assets': {
          status: 500,
          body: { error: { code: 'internal', message: 'Something went wrong on the server.' } },
        },
      },
      '/assets',
    );
    expect(await screen.findByRole('navigation', { name: 'Inventory' })).toBeInTheDocument();
  });
});

describe('a read that failed', () => {
  const detailRoutes = { ...INVENTORY_ROUTES, 'GET /assets/asset-1': { body: LAPTOP_DETAIL } };

  it('says so in the server’s own words instead of an empty inventory', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /assets': DB_DOWN }, '/assets');

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText(/the asset list could not be loaded/i)).toBeInTheDocument();
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // The lie: a failed read drawn as a workspace that has never owned a
    // device, one click away from somebody entering the whole fleet again.
    expect(screen.queryByText(/no assets yet/i)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    // The pills stay — they are how you ask for a different list — but bare:
    // "All 0 · Available 0" is an inventory nobody counted.
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Available' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^All \d/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).toBeNull();
  });

  it('reads the list again when the panel’s retry is pressed', async () => {
    let attempts = 0;
    const api = renderApp(
      {
        ...INVENTORY_ROUTES,
        'GET /assets': (body, search) =>
          attempts++ === 0 ? DB_DOWN : assetsRoute([LAPTOP])(body, search),
      },
      '/assets',
    );

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('MacBook Pro 14"')).toBeInTheDocument();
    expect(api.calledAll('GET /assets')).toHaveLength(2);
  });

  it('fails the whole page when the workflow that names the pills fails', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /workflow': DB_DOWN }, '/assets');

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // Not a table of pills falling back to the slug: that would be this
    // workspace's vocabulary invented by the browser.
    expect(screen.queryByText('MacBook Pro 14"')).toBeNull();
  });

  it('still says the inventory is empty when it genuinely is', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /assets': assetsRoute([]) }, '/assets');

    expect(await screen.findByText(/no assets yet/i)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the way back when one asset cannot be read', async () => {
    renderApp({ ...detailRoutes, 'GET /assets/asset-1': DB_DOWN }, '/assets/asset-1');

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText(/this asset could not be loaded/i)).toBeInTheDocument();
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // The bespoke panel this replaces had one thing worth keeping: a way out
    // of a page that cannot draw itself.
    // Two of them now: the sidebar's, and the page's own way out of a
    // screen that cannot draw itself — the one thing the bespoke panel
    // this replaces had worth keeping.
    expect(screen.getAllByRole('link', { name: 'Assets' })).toHaveLength(2);
  });

  it('fails the asset page when the workflow that names its status fails', async () => {
    renderApp({ ...detailRoutes, 'GET /workflow': DB_DOWN }, '/assets/asset-1');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'MacBook Pro 14"' })).toBeNull();
  });
});

describe('a form whose choices could not be loaded', () => {
  /** The New-asset button is drawn above the page's own failure, deliberately. */
  async function openNewAsset(routes: Parameters<typeof renderApp>[0]) {
    renderApp(routes, '/assets');
    await userEvent.click(await screen.findByRole('button', { name: /new asset/i }));
    return screen.findByRole('dialog', { name: /new asset/i });
  }

  it('says so in the body instead of drawing a Status select with nothing in it', async () => {
    const dialog = await openNewAsset({ ...INVENTORY_ROUTES, 'GET /workflow': DB_DOWN });

    expect(within(dialog).getByRole('alert')).toHaveTextContent('The database is unavailable.');
    expect(within(dialog).queryByLabelText('Name')).toBeNull();
    expect(within(dialog).getByRole('button', { name: /create asset/i })).toBeDisabled();
    // Offering to repeat something that cannot be done once.
    expect(within(dialog).getByRole('checkbox', { name: /create another/i })).toBeDisabled();
  });

  it('will not save a form that never saw the fields this workspace tracks', async () => {
    const dialog = await openNewAsset({ ...INVENTORY_ROUTES, 'GET /custom-fields': DB_DOWN });

    expect(within(dialog).getByRole('alert')).toHaveTextContent('The database is unavailable.');
    // A form drawn past this one would quietly leave out every field the
    // workspace tracks, and save the asset as though it tracked none.
    expect(within(dialog).getByRole('button', { name: /create asset/i })).toBeDisabled();
  });

  it('keeps the form when only the tag suggestion failed, because it is a hint', async () => {
    const dialog = await openNewAsset({ ...INVENTORY_ROUTES, 'GET /assets/next-tag': DB_DOWN });

    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();
    // The API mints a tag when the form sends none, so an absent suggestion
    // changes nothing this form cannot do.
    expect(within(dialog).getByRole('button', { name: /create asset/i })).toBeEnabled();
  });

  it('draws the form again when the panel’s retry is pressed', async () => {
    // Twice: the page's own read, then the one the modal's mount retries.
    let attempts = 0;
    const dialog = await openNewAsset({
      ...INVENTORY_ROUTES,
      'GET /workflow': () => (attempts++ < 2 ? DB_DOWN : { body: WORKFLOW }),
    });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));

    expect(await within(dialog).findByLabelText('Name')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /create asset/i })).toBeEnabled();
  });
});
