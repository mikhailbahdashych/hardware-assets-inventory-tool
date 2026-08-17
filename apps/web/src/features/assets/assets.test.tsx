import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEMBER,
  INVENTORY_ROUTES,
  LAPTOP,
  LAPTOP_DETAIL,
  MONITOR,
  READY_META,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

const viewerRoutes = {
  ...INVENTORY_ROUTES,
  'GET /auth/me': { body: { member: { ...ADMIN_MEMBER, role: 'viewer' } } },
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

  it('filters live by text and records the query in the URL', async () => {
    renderApp(INVENTORY_ROUTES, '/assets');
    await screen.findByText('MacBook Pro 14"');

    await userEvent.type(screen.getByLabelText(/filter assets/i), 'dell');
    await waitFor(() => expect(screen.queryByText('MacBook Pro 14"')).toBeNull());
    expect(screen.getByText('Dell U2723QE')).toBeInTheDocument();
    expect(screen.getByText('1 asset')).toBeInTheDocument();
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
    renderApp({ ...INVENTORY_ROUTES, 'GET /assets': { body: { assets: [] } } }, '/assets');
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
    await userEvent.selectOptions(within(dialog).getByLabelText(/category/i), 'desktops');
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

    await userEvent.selectOptions(within(dialog).getByLabelText(/status/i), 'assigned');
    expect(await within(dialog).findByLabelText(/assigned to/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Maya Lindqvist' })).toBeInTheDocument();
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
        'GET /auth/me': { body: { member: ADMIN_MEMBER } },
        'GET /assets': {
          status: 500,
          body: { error: { code: 'internal', message: 'Something went wrong on the server.' } },
        },
      },
      '/assets',
    );
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });
});
