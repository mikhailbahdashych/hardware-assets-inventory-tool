import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS, type Action, type WorkspaceRole } from '@inventory/shared';
import {
  ADMIN_MEMBER,
  ADMIN_ROUTES,
  MANAGER_ACTIONS,
  ROLES,
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
 * A workspace whose roles answer from a list the test can push to, so a create
 * really does put a row on the page — the same round trip the page makes.
 */
function workspace(routes: StubRoutes = {}): { routes: StubRoutes; roles: WorkspaceRole[] } {
  const roles = ROLES.roles.map((role) => ({ ...role }));
  return {
    roles,
    routes: { ...ADMIN_ROUTES, 'GET /roles': () => ({ body: { roles } }), ...routes },
  };
}

/** The card's role rows, in the order they are drawn (header excluded). */
const roleRows = async () => {
  const card = within(await screen.findByRole('table', { name: 'Roles' }));
  return card.getAllByRole('row').filter((row) => row.dataset.testid !== 'table-header');
};

/** What the first cell of each row says — the pill, and so the role. */
const rowLabels = (rows: HTMLElement[]) =>
  rows.map((row) => within(row).getAllByRole('cell')[0]!.textContent);

describe('reaching the roles page', () => {
  it('is in the admin section of the sidebar, after the workflow', async () => {
    renderApp(workspace().routes, '/roles');
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Roles' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'Roles' })).toBeInTheDocument();
  });

  it('is hidden from a manager, and out of reach even by URL', async () => {
    renderApp(
      {
        ...workspace().routes,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/roles',
    );
    await screen.findByRole('navigation');
    expect(screen.queryByRole('link', { name: 'Roles' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('Dashboard', { selector: 'h1' })).toBeInTheDocument(),
    );
  });
});

describe('the roles card', () => {
  it('lists every role in the workspace order, with its own pill and description', async () => {
    renderApp(workspace().routes, '/roles');

    const rows = await roleRows();
    expect(rowLabels(rows)).toEqual(['Admin', 'Manager', 'Viewer']);
    expect(within(rows[0]!).getByText('Admin')).toHaveAttribute('data-sv', 'acc');
    expect(within(rows[2]!).getByText('Read-only access to all pages')).toBeInTheDocument();
  });

  it('says how many people hold each role', async () => {
    renderApp(workspace().routes, '/roles');
    const rows = await roleRows();
    expect(within(rows[1]!).getByText('1 member')).toBeInTheDocument();
  });

  it('locks the system role: it cannot be edited or deleted', async () => {
    renderApp(workspace().routes, '/roles');
    const rows = await roleRows();
    const admin = within(rows[0]!);

    expect(admin.queryByRole('button', { name: /^Edit Admin/ })).toBeNull();
    expect(admin.queryByRole('button', { name: /^Delete Admin/ })).toBeNull();
    // The ordinary rows keep both.
    expect(within(rows[1]!).getByRole('button', { name: 'Edit Manager' })).toBeEnabled();
    expect(within(rows[1]!).getByRole('button', { name: 'Delete Manager' })).toBeEnabled();
  });

  it('locks the row of the role the reader holds, whatever else they may do', async () => {
    // A member holding Manager, in a workspace that granted Manager the right
    // to manage roles. Admin is locked because it is the system role; Manager
    // is locked because it is theirs — two different rules, and this is the
    // only arrangement that tells them apart.
    renderApp(
      {
        ...workspace().routes,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, ['roles.manage']),
      },
      '/roles',
    );
    const rows = await roleRows();

    expect(
      within(rows[1]!).getByRole('button', { name: 'Edit Manager — ask another admin' }),
    ).toBeDisabled();
    expect(
      within(rows[1]!).getByRole('button', { name: 'Delete Manager — ask another admin' }),
    ).toBeDisabled();
    // Everybody else's row is still theirs to edit.
    expect(within(rows[2]!).getByRole('button', { name: 'Edit Viewer' })).toBeEnabled();
  });

  it('reorders by sending the whole order, not one row', async () => {
    const { routes, roles } = workspace();
    const api = renderApp(
      {
        ...routes,
        'POST /roles/order': (body) => {
          const { order } = body as { order: string[] };
          roles.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
          return { status: 204 };
        },
      },
      '/roles',
    );
    const rows = await roleRows();

    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Move Manager up' }));
    await waitFor(() => expect(api.called('POST /roles/order')).toBeDefined());
    expect(api.called('POST /roles/order')!.body).toEqual({
      order: ['manager', 'admin', 'viewer'],
    });
  });

  it('cannot move the first role up or the last one down', async () => {
    renderApp(workspace().routes, '/roles');
    const rows = await roleRows();

    expect(within(rows[0]!).getByRole('button', { name: 'Move Admin up' })).toBeDisabled();
    expect(within(rows.at(-1)!).getByRole('button', { name: 'Move Viewer down' })).toBeDisabled();
  });
});

describe('the role form', () => {
  it('adds a role, and the row it created appears', async () => {
    const { routes, roles } = workspace();
    const api = renderApp(
      {
        ...routes,
        'POST /roles': (body) => {
          const input = body as Pick<WorkspaceRole, 'label' | 'description' | 'color'>;
          const created: WorkspaceRole = {
            ...input,
            id: 'auditor',
            isSystem: false,
            sortOrder: roles.length,
            memberCount: 0,
            permissions: [],
          };
          roles.push(created);
          return { status: 201, body: { role: created } };
        },
      },
      '/roles',
    );
    await roleRows();

    await userEvent.click(screen.getByRole('button', { name: 'Add role' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Auditor');
    // The id it will get, before the row exists.
    expect(within(dialog).getByText('Stored as auditor')).toBeInTheDocument();
    expect(within(dialog).getByText(/New roles start with no permissions/)).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText('Description'),
      'Reads the books: activity log and exports',
    );
    await choose(within(dialog), 'Color', /Amber/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add role' }));

    await waitFor(() => expect(api.called('POST /roles')).toBeDefined());
    expect(api.called('POST /roles')!.body).toEqual({
      label: 'Auditor',
      description: 'Reads the books: activity log and exports',
      color: 'warn',
    });
    await waitFor(async () => expect(rowLabels(await roleRows())).toContain('Auditor'));
  });

  it('puts the server’s complaint about a taken label under the field', async () => {
    renderApp(
      {
        ...workspace().routes,
        'POST /roles': {
          status: 422,
          body: {
            error: {
              code: 'validation',
              message: 'That name is taken.',
              fields: { label: 'A role called "Manager" already exists.' },
            },
          },
        },
      },
      '/roles',
    );
    await roleRows();

    await userEvent.click(screen.getByRole('button', { name: 'Add role' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Manager');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add role' }));

    expect(await within(dialog).findByText('A role called "Manager" already exists.')).toBeInTheDocument(); // prettier-ignore
  });

  it('renames a role without touching its id', async () => {
    const { routes, roles } = workspace();
    const api = renderApp(
      {
        ...routes,
        'PATCH /roles/manager': (body) => {
          const patch = body as { label: string };
          const row = roles.find((role) => role.id === 'manager')!;
          row.label = patch.label;
          return { body: { role: row } };
        },
      },
      '/roles',
    );
    const rows = await roleRows();

    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Edit Manager' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Stored as manager — renaming leaves that alone')).toBeInTheDocument(); // prettier-ignore
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Team lead');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(api.called('PATCH /roles/manager')).toBeDefined());
    expect(api.called('PATCH /roles/manager')!.body).toEqual({
      label: 'Team lead',
      description: 'Create and edit assets, employees and assignments',
      color: 'info',
    });
    await waitFor(async () => expect(rowLabels(await roleRows())).toContain('Team lead'));
  });
});

describe('deleting a role', () => {
  it('asks where the members go when the role somebody is deleting is held', async () => {
    const { routes } = workspace();
    const api = renderApp(
      {
        ...routes,
        'DELETE /roles/manager': (_body, search) =>
          search.includes('migrateTo')
            ? { status: 204 }
            : {
                status: 409,
                body: {
                  error: {
                    code: 'role_in_use',
                    message: '3 members hold this role. Choose where to move them first.',
                  },
                },
              },
      },
      '/roles',
    );
    const rows = await roleRows();

    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Delete Manager' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));

    // The server counts the members; the modal repeats what it said rather than
    // counting again from a list it may not have loaded.
    expect(await within(dialog).findByText(/3 members hold this role/)).toBeInTheDocument();
    await choose(within(dialog), 'Move them to', 'Viewer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move and delete' }));

    await waitFor(() => expect(api.calledAll('DELETE /roles/manager')).toHaveLength(2));
    expect(api.calledAll('DELETE /roles/manager')[1]!.search).toBe('?migrateTo=viewer');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('defaults the migration to the least-privileged destination, never Admin', async () => {
    const { routes } = workspace();
    const api = renderApp(
      {
        ...routes,
        'DELETE /roles/manager': (_body, search) =>
          search.includes('migrateTo')
            ? { status: 204 }
            : {
                status: 409,
                body: {
                  error: {
                    code: 'role_in_use',
                    message: '3 members hold this role. Choose where to move them first.',
                  },
                },
              },
      },
      '/roles',
    );
    const rows = await roleRows();

    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'Delete Manager' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));
    await within(dialog).findByText(/3 members hold this role/);

    // Straight to the button: the preselected destination is the role granting
    // the fewest actions, so a hasty "Move and delete" is a demotion at worst.
    // Admin is first in the list, and defaulting there would make the same
    // haste a mass promotion.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move and delete' }));

    await waitFor(() => expect(api.calledAll('DELETE /roles/manager')).toHaveLength(2));
    expect(api.calledAll('DELETE /roles/manager')[1]!.search).toBe('?migrateTo=viewer');
  });

  it('deletes a role nobody holds in one press', async () => {
    const { routes, roles } = workspace();
    const api = renderApp(
      {
        ...routes,
        'DELETE /roles/viewer': () => {
          roles.splice(
            roles.findIndex((role) => role.id === 'viewer'),
            1,
          );
          return { status: 204 };
        },
      },
      '/roles',
    );
    const rows = await roleRows();

    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Delete Viewer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));

    await waitFor(() => expect(api.called('DELETE /roles/viewer')).toBeDefined());
    await waitFor(async () => expect(rowLabels(await roleRows())).not.toContain('Viewer'));
  });
});

describe('the permissions matrix', () => {
  /** One cell of the grid, by the role and the action it stands for. */
  const cell = (role: string, action: string) =>
    screen.getByRole('checkbox', { name: new RegExp(`^${role}: ${action}`) });

  it('draws every action under the group it belongs to', async () => {
    renderApp(workspace().routes, '/roles');
    const table = within(await screen.findByRole('table', { name: 'Permissions' }));

    // Five group bands plus one row per action, and no action left out.
    const rows = table.getAllByRole('row').filter((row) => row.dataset.testid !== 'table-header');
    expect(rows).toHaveLength(ACTIONS.length + 5);
    for (const group of ['Assets', 'Employees', 'People', 'Data', 'Administration']) {
      expect(table.getByText(group)).toBeInTheDocument();
    }
    expect(table.getByText('Manage roles and permissions')).toBeInTheDocument();
    // A band names its area and nothing else — no checkbox belongs to it.
    expect(within(rows[0]!).queryByRole('checkbox')).toBeNull();
  });

  it('ticks and locks every box in the system role’s column', async () => {
    renderApp(workspace().routes, '/roles');
    await screen.findByRole('table', { name: 'Permissions' });

    expect(cell('Admin', 'Delete the workspace')).toBeChecked();
    expect(cell('Admin', 'Delete the workspace')).toBeDisabled();
    expect(cell('Admin', 'Create assets')).toBeChecked();
    expect(cell('Manager', 'Create assets')).toBeChecked();
    expect(cell('Manager', 'Create assets')).toBeEnabled();
    expect(cell('Viewer', 'Create assets')).not.toBeChecked();
  });

  it('saves the grants the boxes hold, and only once something has changed', async () => {
    const { routes, roles } = workspace();
    const api = renderApp(
      {
        ...routes,
        'PUT /roles/permissions': (body) => {
          const { grants } = body as { grants: { role: string; action: Action }[] };
          for (const role of roles) {
            if (role.isSystem) continue;
            role.permissions = grants
              .filter((grant) => grant.role === role.id)
              .map((grant) => grant.action);
          }
          return { body: { added: 1, removed: 0 } };
        },
      },
      '/roles',
    );
    await screen.findByRole('table', { name: 'Permissions' });

    const save = () => screen.getByRole('button', { name: 'Save permissions' });
    expect(save()).toBeDisabled();

    await userEvent.click(cell('Viewer', 'View the activity log'));
    expect(save()).toBeEnabled();
    await userEvent.click(save());

    await waitFor(() => expect(api.called('PUT /roles/permissions')).toBeDefined());
    const sent = api.called('PUT /roles/permissions')!.body as {
      grants: { role: string; action: string }[];
    };
    expect(sent.grants).toContainEqual({ role: 'viewer', action: 'audit.view' });
    // Every other role's column travels too — the matrix saves the whole grid.
    expect(sent.grants).toContainEqual({ role: 'manager', action: 'assets.create' });
    // The system role's column is not the workspace's to send.
    expect(sent.grants.some((grant) => grant.role === 'admin')).toBe(false);

    // Saved is the new starting point: the draft re-seeds from what came back.
    await waitFor(() => expect(save()).toBeDisabled());
    expect(cell('Viewer', 'View the activity log')).toBeChecked();
  });

  it('locks the column of the role the reader holds, and only that one', async () => {
    renderApp(
      {
        ...workspace().routes,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, ['roles.manage']),
      },
      '/roles',
    );
    await screen.findByRole('table', { name: 'Permissions' });

    const own = screen.getByRole('checkbox', {
      name: 'Manager: Create assets — ask another admin',
    });
    expect(own).toBeDisabled();
    expect(own).toBeChecked();
    expect(cell('Viewer', 'Create assets')).toBeEnabled();
    expect(cell('Admin', 'Create assets')).toBeDisabled();
  });

  it('lets a change be abandoned', async () => {
    renderApp(workspace().routes, '/roles');
    await screen.findByRole('table', { name: 'Permissions' });

    await userEvent.click(cell('Manager', 'Create assets'));
    expect(cell('Manager', 'Create assets')).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(cell('Manager', 'Create assets')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeDisabled();
  });
});
