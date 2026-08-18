import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStatus } from '@inventory/shared';
import {
  ADMIN_MEMBER,
  ADMIN_ROUTES,
  MANAGER_ACTIONS,
  session,
  WORKFLOW,
  type StubRoutes,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

/**
 * A workspace whose workflow answers from a list the test can push to, so a
 * create really does put a row on the page — the same round trip the page makes.
 */
function workspace(routes: StubRoutes = {}): { routes: StubRoutes; statuses: WorkflowStatus[] } {
  const statuses = WORKFLOW.statuses.map((status) => ({ ...status }));
  return {
    statuses,
    routes: {
      ...ADMIN_ROUTES,
      'GET /workflow': () => ({ body: { statuses, transitions: WORKFLOW.transitions } }),
      ...routes,
    },
  };
}

/** The card's status rows, in the order they are drawn (header excluded). */
const statusRows = async () => {
  const card = within(await screen.findByRole('table', { name: 'Statuses' }));
  return card.getAllByRole('row').filter((row) => row.dataset.testid !== 'table-header');
};

/** What the first cell of each row says — the pill, and so the status. */
const rowLabels = (rows: HTMLElement[]) =>
  rows.map((row) => within(row).getAllByRole('cell')[0]!.textContent);

describe('reaching the workflow page', () => {
  it('is in the admin section of the sidebar, between the log and the settings', async () => {
    renderApp(workspace().routes, '/workflow');
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'Workflow' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('heading', { name: 'Workflow' })).toBeInTheDocument();
  });

  it('is hidden from a manager, and out of reach even by URL', async () => {
    renderApp(
      {
        ...workspace().routes,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/workflow',
    );
    await screen.findByRole('navigation');
    expect(screen.queryByRole('link', { name: 'Workflow' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByText('Dashboard', { selector: 'h1' })).toBeInTheDocument(),
    );
  });
});

describe('the statuses card', () => {
  it('lists every status in the workspace order, with its own pill', async () => {
    renderApp(workspace().routes, '/workflow');

    const rows = await statusRows();
    expect(rowLabels(rows)).toEqual([
      'Available',
      'Assigned',
      'In repair',
      'Ordered',
      'Retired',
      'Lost/Stolen',
    ]);
    expect(within(rows[2]!).getByText('In repair')).toHaveAttribute('data-sv', 'warn');
  });

  it('locks the system status: no delete, and flags that cannot be flipped', async () => {
    renderApp(workspace().routes, '/workflow');
    const rows = await statusRows();
    const assigned = within(rows[1]!);

    expect(assigned.queryByRole('button', { name: 'Delete Assigned' })).toBeNull();
    expect(assigned.getByRole('switch', { name: 'Assigned can be handed out' })).toBeDisabled();
    expect(assigned.getByRole('switch', { name: 'Assigned accepts check-ins' })).toBeDisabled();
    // Its words and its colour are still the workspace's to choose.
    expect(assigned.getByRole('button', { name: 'Edit Assigned' })).toBeEnabled();
  });

  it('adds a status, and the row it created appears', async () => {
    const { routes, statuses } = workspace();
    const api = renderApp(
      {
        ...routes,
        'POST /workflow/statuses': (body) => {
          const input = body as { label: string; color: WorkflowStatus['color'] };
          const created: WorkflowStatus = {
            id: 'on_loan',
            label: input.label,
            color: input.color,
            isSystem: false,
            assignableFrom: false,
            checkinTarget: false,
            sortOrder: statuses.length,
          };
          statuses.push(created);
          return { status: 201, body: { status: created } };
        },
      },
      '/workflow',
    );
    await statusRows();

    await userEvent.click(screen.getByRole('button', { name: 'Add status' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'On loan');
    await choose(within(dialog), 'Color', /Blue/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add status' }));

    await waitFor(() => expect(api.called('POST /workflow/statuses')).toBeDefined());
    expect(api.called('POST /workflow/statuses')!.body).toEqual({
      label: 'On loan',
      color: 'info',
      // A new status starts with no behaviour; the row's toggles give it some.
      assignableFrom: false,
      checkinTarget: false,
    });
    await waitFor(async () => expect(rowLabels(await statusRows())).toContain('On loan'));
  });

  it('renames a status without touching its id', async () => {
    const { routes, statuses } = workspace();
    const api = renderApp(
      {
        ...routes,
        'PATCH /workflow/statuses/in_repair': (body) => {
          const patch = body as { label: string };
          const row = statuses.find((status) => status.id === 'in_repair')!;
          row.label = patch.label;
          return { body: { status: row } };
        },
      },
      '/workflow',
    );
    const rows = await statusRows();

    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Edit In repair' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'At the shop');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save status' }));

    await waitFor(() => expect(api.called('PATCH /workflow/statuses/in_repair')).toBeDefined());
    expect(api.called('PATCH /workflow/statuses/in_repair')!.body).toEqual({
      label: 'At the shop',
      color: 'warn',
    });
    await waitFor(async () => expect(rowLabels(await statusRows())).toContain('At the shop'));
  });

  it('flips a behaviour flag straight from the row', async () => {
    const { routes, statuses } = workspace();
    const api = renderApp(
      {
        ...routes,
        'PATCH /workflow/statuses/ordered': (body) => {
          const patch = body as { checkinTarget: boolean };
          const row = statuses.find((status) => status.id === 'ordered')!;
          row.checkinTarget = patch.checkinTarget;
          return { body: { status: row } };
        },
      },
      '/workflow',
    );
    const rows = await statusRows();

    await userEvent.click(within(rows[3]!).getByRole('switch', { name: 'Ordered accepts check-ins' })); // prettier-ignore
    await waitFor(() => expect(api.called('PATCH /workflow/statuses/ordered')).toBeDefined());
    expect(api.called('PATCH /workflow/statuses/ordered')!.body).toEqual({ checkinTarget: true });
  });

  it('reorders by sending the whole list, not one row', async () => {
    const { routes, statuses } = workspace();
    const api = renderApp(
      {
        ...routes,
        'PUT /workflow/statuses/order': (body) => {
          const { ids } = body as { ids: string[] };
          statuses.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
          return { body: { statuses } };
        },
      },
      '/workflow',
    );
    const rows = await statusRows();

    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Move In repair up' }));
    await waitFor(() => expect(api.called('PUT /workflow/statuses/order')).toBeDefined());
    expect(api.called('PUT /workflow/statuses/order')!.body).toEqual({
      ids: ['available', 'in_repair', 'assigned', 'ordered', 'retired', 'lost_stolen'],
    });
  });

  it('cannot move the first status up or the last one down', async () => {
    renderApp(workspace().routes, '/workflow');
    const rows = await statusRows();

    expect(within(rows[0]!).getByRole('button', { name: 'Move Available up' })).toBeDisabled();
    expect(
      within(rows.at(-1)!).getByRole('button', { name: 'Move Lost/Stolen down' }),
    ).toBeDisabled();
  });

  it('asks where the assets go when the status somebody is deleting is in use', async () => {
    const { routes } = workspace();
    const api = renderApp(
      {
        ...routes,
        'DELETE /workflow/statuses/in_repair': (_body, search) =>
          search.includes('migrateTo')
            ? { status: 204 }
            : {
                status: 409,
                body: {
                  error: {
                    code: 'status_in_use',
                    message: '3 assets are in this status. Choose where to move them first.',
                  },
                },
              },
      },
      '/workflow',
    );
    const rows = await statusRows();

    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'Delete In repair' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete status' }));

    // The server counts the assets; the modal repeats what it said rather than
    // counting again from a list it may not have loaded.
    expect(await within(dialog).findByText(/3 assets are in this status/)).toBeInTheDocument();
    await choose(within(dialog), 'Move them to', 'Available');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move and delete' }));

    await waitFor(() =>
      expect(api.calledAll('DELETE /workflow/statuses/in_repair')).toHaveLength(2),
    );
    expect(api.calledAll('DELETE /workflow/statuses/in_repair')[1]!.search).toBe(
      '?migrateTo=available',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('deletes a status nothing carries in one press', async () => {
    const { routes, statuses } = workspace();
    const api = renderApp(
      {
        ...routes,
        'DELETE /workflow/statuses/lost_stolen': () => {
          statuses.splice(
            statuses.findIndex((status) => status.id === 'lost_stolen'),
            1,
          );
          return { status: 204 };
        },
      },
      '/workflow',
    );
    const rows = await statusRows();

    await userEvent.click(within(rows.at(-1)!).getByRole('button', { name: 'Delete Lost/Stolen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete status' }));

    await waitFor(() => expect(api.called('DELETE /workflow/statuses/lost_stolen')).toBeDefined());
    await waitFor(() => expect(screen.queryByText('Lost/Stolen')).toBeNull());
  });
});

describe('the transition matrix', () => {
  /** One cell of the grid, by the move it stands for. */
  const cell = (from: string, to: string) =>
    screen.getByRole('checkbox', { name: `${from} → ${to}` });

  it('draws a cell per ordered pair, with the diagonal and Assigned left out', async () => {
    renderApp(workspace().routes, '/workflow');
    await screen.findByRole('table', { name: 'Transitions' });

    // Five statuses can be moved between directly; the sixth is entered by
    // assigning and left by checking in.
    expect(screen.getAllByRole('checkbox')).toHaveLength(25);
    expect(screen.queryByRole('checkbox', { name: /Assigned/ })).toBeNull();
    expect(cell('Available', 'Retired')).toBeChecked();
    // A status cannot transition to itself, so that cell is never a choice.
    expect(cell('Available', 'Available')).toBeDisabled();
    expect(cell('Available', 'Available')).not.toBeChecked();
  });

  it('saves the graph the boxes hold, and only once something has changed', async () => {
    const { routes } = workspace();
    let stored = WORKFLOW.transitions;
    const api = renderApp(
      {
        ...routes,
        'GET /workflow': () => ({ body: { statuses: WORKFLOW.statuses, transitions: stored } }),
        'PUT /workflow/transitions': (body) => {
          stored = (body as { transitions: typeof stored }).transitions;
          return { body: { transitions: stored } };
        },
      },
      '/workflow',
    );
    await screen.findByRole('table', { name: 'Transitions' });

    const save = screen.getByRole('button', { name: 'Save workflow' });
    expect(save).toBeDisabled();

    await userEvent.click(cell('Available', 'Retired'));
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(api.called('PUT /workflow/transitions')).toBeDefined());
    const sent = api.called('PUT /workflow/transitions')!.body as {
      transitions: { from: string; to: string }[];
    };
    expect(sent.transitions).toHaveLength(WORKFLOW.transitions.length - 1);
    expect(sent.transitions).not.toContainEqual({ from: 'available', to: 'retired' });

    // Saved is the new starting point: the draft re-seeds from what came back.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save workflow' })).toBeDisabled(),
    );
    expect(cell('Available', 'Retired')).not.toBeChecked();
  });

  it('redraws the diagram from the draft, before anything is saved', async () => {
    renderApp(workspace().routes, '/workflow');
    await screen.findByRole('table', { name: 'Transitions' });
    const diagram = () => screen.getByRole('img', { name: /Workflow diagram/ });

    expect(diagram().querySelector('[data-edge="available→retired"]')).not.toBeNull();
    await userEvent.click(cell('Available', 'Retired'));
    // Unsaved, and already gone from the picture.
    expect(diagram().querySelector('[data-edge="available→retired"]')).toBeNull();
    expect(diagram().querySelector('[data-edge="retired→available"]')).not.toBeNull();
  });

  it('lets a change be abandoned', async () => {
    renderApp(workspace().routes, '/workflow');
    await screen.findByRole('table', { name: 'Transitions' });

    await userEvent.click(cell('In repair', 'Available'));
    expect(cell('In repair', 'Available')).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(cell('In repair', 'Available')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save workflow' })).toBeDisabled();
  });
});
