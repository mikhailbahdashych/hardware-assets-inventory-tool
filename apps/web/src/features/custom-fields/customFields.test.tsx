import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEMBER,
  CUSTOM_FIELDS,
  DASHBOARD_ROUTES,
  INVENTORY_ROUTES,
  MANAGER_ACTIONS,
  session,
  type StubRoutes,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

/**
 * A workspace whose definitions answer from a list the test can push to, so a
 * create really does put a row on the page — the same round trip the page makes.
 */
function workspace(
  fields: unknown[] = CUSTOM_FIELDS.map((field) => ({ ...field })),
  routes: StubRoutes = {},
): { routes: StubRoutes; fields: unknown[] } {
  return {
    fields,
    routes: {
      ...INVENTORY_ROUTES,
      'GET /custom-fields': () => ({ body: { customFields: fields } }),
      ...routes,
    },
  };
}

/** One definition's row, found by the key its values hang off. */
const rowFor = async (key: string) =>
  (await screen.findByText(key)).closest('[data-field]') as HTMLElement;

describe('reaching the custom fields page', () => {
  it('sits in the workspace half of the sidebar, marked current', async () => {
    renderApp(workspace().routes, '/custom-fields');
    const nav = await screen.findByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('link', { name: 'Custom fields' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'Custom fields' })).toBeInTheDocument();
  });

  it('is hidden from a manager, and out of reach even by URL', async () => {
    renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/custom-fields',
    );
    const nav = await screen.findByRole('navigation', { name: 'Workspace' });
    expect(within(nav).queryByRole('link', { name: 'Custom fields' })).toBeNull();
    // The door is locked, not merely hidden: the URL lands on the dashboard.
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Custom fields' })).toBeNull();
  });
});

describe('the definitions list', () => {
  it('names every field with the key its values hang off, and its type', async () => {
    renderApp(workspace().routes, '/custom-fields');

    const mdm = await rowFor('mdm_enrolled');
    expect(mdm).toHaveTextContent('MDM enrolled');
    expect(mdm).toHaveTextContent('Yes / No');
    expect(await rowFor('hostname')).toHaveTextContent('Text');
  });

  it('says so in the app’s voice when a workspace has defined none', async () => {
    renderApp(workspace([]).routes, '/custom-fields');
    expect(await screen.findByText(/No custom fields yet/i)).toBeInTheDocument();
  });

  it('adds a field and says which key values will hang off', async () => {
    const created = {
      id: 'cf-3',
      key: 'warranty_provider',
      label: 'Warranty provider',
      type: 'text',
      sortOrder: 2,
    };
    const { routes, fields } = workspace(undefined, {
      'POST /custom-fields': () => {
        fields.push(created);
        return { body: { customField: created } };
      },
    });
    const api = renderApp(routes, '/custom-fields');
    await userEvent.type(await screen.findByLabelText(/new field/i), 'Warranty provider');
    await choose(screen, /type/i, 'Text');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));

    await waitFor(() => expect(api.called('POST /custom-fields')).toBeDefined());
    expect(api.called('POST /custom-fields')!.body).toEqual({
      label: 'Warranty provider',
      type: 'text',
    });
    expect(await screen.findByText('warranty_provider')).toBeInTheDocument();
  });

  it('renames a field without moving the key underneath it', async () => {
    const api = renderApp(
      workspace(undefined, { 'PATCH /custom-fields/cf-2': { body: { customField: {} } } }).routes,
      '/custom-fields',
    );
    const row = await rowFor('hostname');

    await userEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    const input = within(row).getByLabelText('Rename Hostname');
    await userEvent.clear(input);
    await userEvent.type(input, 'Machine name');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.called('PATCH /custom-fields/cf-2')).toBeDefined());
    expect(api.called('PATCH /custom-fields/cf-2')!.body).toMatchObject({ label: 'Machine name' });
  });

  it('warns that deleting takes the values, and only then deletes', async () => {
    const api = renderApp(
      workspace(undefined, { 'DELETE /custom-fields/cf-2': { status: 204 } }).routes,
      '/custom-fields',
    );
    const row = await rowFor('hostname');

    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(api.called('DELETE /custom-fields/cf-2')).toBeUndefined();

    await userEvent.click(within(row).getByRole('button', { name: 'Delete values too' }));
    await waitFor(() => expect(api.called('DELETE /custom-fields/cf-2')).toBeDefined());
  });
});
