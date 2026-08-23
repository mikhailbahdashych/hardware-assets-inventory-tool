import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ATTACHMENT_ACCEPT } from '@inventory/shared';
import {
  ADMIN_MEMBER,
  INVENTORY_ROUTES,
  LAPTOP,
  LAPTOP_DETAIL,
  MANAGER_ACTIONS,
  MAYA_DETAIL,
  MONITOR,
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

const detailRoutes = {
  ...INVENTORY_ROUTES,
  'GET /assets/asset-1': { body: LAPTOP_DETAIL },
  'GET /employees/emp-1': { body: MAYA_DETAIL },
};

const viewer = { 'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'viewer' }, VIEWER_ACTIONS) };

describe('the contextual primary action', () => {
  it('offers Check in for an asset somebody holds', async () => {
    renderApp(detailRoutes, '/assets/asset-1');
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeInTheDocument();
  });

  it('offers Assign for a free asset', async () => {
    renderApp(
      {
        ...detailRoutes,
        'GET /assets/asset-1': {
          body: {
            ...LAPTOP_DETAIL,
            asset: { ...LAPTOP, status: 'available', currentHolder: null },
          },
        },
      },
      '/assets/asset-1',
    );
    expect(await screen.findByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });

  it('offers Change status for an asset in repair — the design misroutes this to Assign', async () => {
    renderApp(
      {
        ...detailRoutes,
        'GET /assets/asset-1': {
          body: { ...LAPTOP_DETAIL, asset: { ...MONITOR, id: 'asset-1' } },
        },
      },
      '/assets/asset-1',
    );
    expect(await screen.findByRole('button', { name: 'Change status' })).toBeInTheDocument();
  });

  it('gives a viewer no action at all', async () => {
    renderApp({ ...detailRoutes, ...viewer }, '/assets/asset-1');
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('assigning from an asset', () => {
  const freeAsset = {
    ...detailRoutes,
    'GET /assets/asset-1': {
      body: { ...LAPTOP_DETAIL, asset: { ...LAPTOP, status: 'available', currentHolder: null } },
    },
  };

  it('picks a person, then posts the handover', async () => {
    const api = renderApp(
      { ...freeAsset, 'POST /assets/asset-1/assign': { body: { asset: LAPTOP } } },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Assign' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('option', { name: /Maya Lindqvist/ }));
    fireEvent.change(within(dialog).getByLabelText(/checkout date/i), {
      target: { value: '2026-03-14' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign asset' }));

    await waitFor(() => expect(api.called('POST /assets/asset-1/assign')).toBeDefined());
    expect(api.called('POST /assets/asset-1/assign')!.body).toMatchObject({
      employeeId: 'emp-1',
      checkoutDate: '2026-03-14',
    });
  });

  it('will not submit until somebody is chosen', async () => {
    renderApp(freeAsset, '/assets/asset-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Assign' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Assign asset' })).toBeDisabled();
  });

  it('narrows the candidates as you type, and offers only active people', async () => {
    renderApp(
      {
        ...freeAsset,
        'GET /employees': {
          body: {
            employees: [
              MAYA_DETAIL.employee,
              {
                ...MAYA_DETAIL.employee,
                id: 'emp-2',
                displayName: 'Daniel Okafor',
                department: 'Engineering',
              },
              {
                ...MAYA_DETAIL.employee,
                id: 'emp-3',
                displayName: 'Leaving Person',
                status: 'offboarding',
              },
            ],
          },
        },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Assign' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('option', { name: /Leaving Person/ })).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/search people/i), 'engineering');
    await waitFor(() =>
      expect(within(dialog).queryByRole('option', { name: /Maya Lindqvist/ })).toBeNull(),
    );
    expect(within(dialog).getByRole('option', { name: /Daniel Okafor/ })).toBeInTheDocument();
  });

  it('shows the server refusal when the asset was taken meanwhile', async () => {
    renderApp(
      {
        ...freeAsset,
        'POST /assets/asset-1/assign': {
          status: 409,
          body: {
            error: {
              code: 'asset_unavailable',
              message: 'Only an available or ordered asset can be handed out.',
            },
          },
        },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Assign' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('option', { name: /Maya Lindqvist/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign asset' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/can be handed out/i);
  });
});

describe('checking in', () => {
  it('posts the return, its condition and where the asset lands', async () => {
    const api = renderApp(
      {
        ...detailRoutes,
        'POST /assets/asset-1/checkin': {
          body: { asset: { ...LAPTOP, status: 'in_repair', currentHolder: null } },
        },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Check in' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Returning from Maya Lindqvist');
    fireEvent.change(within(dialog).getByLabelText(/return date/i), {
      target: { value: '2026-08-16' },
    });
    await choose(within(dialog), /condition/i, 'Needs repair');
    await userEvent.click(within(dialog).getByRole('button', { name: 'In repair' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check in asset' }));

    await waitFor(() => expect(api.called('POST /assets/asset-1/checkin')).toBeDefined());
    expect(api.called('POST /assets/asset-1/checkin')!.body).toMatchObject({
      returnDate: '2026-08-16',
      condition: 'needs_repair',
      newStatus: 'in_repair',
    });
  });

  it('offers the statuses flagged as check-in destinations, and never Assigned', async () => {
    renderApp(detailRoutes, '/assets/asset-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    const dialog = await screen.findByRole('dialog');

    // The status speaks for itself now — no "Return to stock" rewording of a
    // label an admin chose.
    expect(within(dialog).getByRole('button', { name: 'Available' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Retired' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Assigned' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Ordered' })).toBeNull();
  });

  it('follows the workspace flags rather than a list of slugs', async () => {
    renderApp(
      {
        ...detailRoutes,
        'GET /workflow': {
          body: {
            ...WORKFLOW,
            statuses: [
              ...WORKFLOW.statuses.map((status) =>
                status.id === 'in_repair' ? { ...status, checkinTarget: false } : status,
              ),
              {
                id: 'on_loan',
                label: 'On loan',
                color: 'info',
                isSystem: false,
                assignableFrom: false,
                checkinTarget: true,
                sortOrder: 6,
              },
            ],
          },
        },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: 'On loan' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'In repair' })).toBeNull();
  });
});

describe('changing status', () => {
  it('offers exactly what the workflow has an edge to', async () => {
    // The graph is the truth: take one edge away and the option goes with it,
    // rather than the modal offering a move the API would refuse.
    renderApp(
      {
        ...detailRoutes,
        'GET /assets/asset-1': { body: { ...LAPTOP_DETAIL, asset: { ...MONITOR, id: 'asset-1' } } },
        'GET /workflow': {
          body: {
            ...WORKFLOW,
            transitions: WORKFLOW.transitions.filter(
              (edge) => !(edge.from === 'in_repair' && edge.to === 'retired'),
            ),
          },
        },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Change status' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /new status/i }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Available');
    expect(options).not.toContain('Retired');
  });

  it('says so when the workflow allows no move at all', async () => {
    renderApp(
      {
        ...detailRoutes,
        'GET /assets/asset-1': { body: { ...LAPTOP_DETAIL, asset: { ...MONITOR, id: 'asset-1' } } },
        'GET /workflow': {
          body: {
            ...WORKFLOW,
            transitions: WORKFLOW.transitions.filter((edge) => edge.from !== 'in_repair'),
          },
        },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Change status' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('The workflow allows no moves from In repair.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: /new status/i })).toBeNull();
  });

  it('offers every status except the current one and Assigned', async () => {
    renderApp(
      {
        ...detailRoutes,
        'GET /assets/asset-1': { body: { ...LAPTOP_DETAIL, asset: { ...MONITOR, id: 'asset-1' } } },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Change status' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /new status/i }));
    // The list is portalled to the body, so it is read from the screen.
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Available');
    expect(options).toContain('Retired');
    expect(options).not.toContain('Assigned');
    expect(options).not.toContain('In repair');
  });

  it('sends the move as an ordinary edit', async () => {
    const api = renderApp(
      {
        ...detailRoutes,
        'GET /assets/asset-1': { body: { ...LAPTOP_DETAIL, asset: { ...MONITOR, id: 'asset-1' } } },
        'PATCH /assets/asset-1': { body: { asset: { ...MONITOR, status: 'retired' } } },
      },
      '/assets/asset-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Change status' }));
    const dialog = await screen.findByRole('dialog');
    await choose(within(dialog), /new status/i, 'Retired');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change status' }));

    await waitFor(() => expect(api.called('PATCH /assets/asset-1')).toBeDefined());
    expect(api.called('PATCH /assets/asset-1')!.body).toEqual({ status: 'retired' });
  });
});

describe('the asset detail record', () => {
  it('draws the ownership timeline, its gap and its origin', async () => {
    renderApp(detailRoutes, '/assets/asset-1');
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });

    const timeline = screen.getByRole('list');
    const entries = within(timeline)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(entries[0]).toContain('Maya Lindqvist');
    expect(entries[0]).toContain('Mar 2024 → present');
    expect(entries[1]).toContain('In stock');
    expect(entries[2]).toContain('Elena Vasquez');
    expect(entries[2]).toContain('offboarded');
    expect(entries.at(-1)).toContain('Added to inventory');
  });

  it('renders the audit trail as sentences, not action slugs', async () => {
    renderApp(detailRoutes, '/assets/asset-1');
    expect(
      await screen.findByText(/Assigned MacBook Pro 14" to Maya Lindqvist/),
    ).toBeInTheDocument();
    expect(screen.queryByText('asset.assigned')).toBeNull();
  });

  it('lists attachments as downloads', async () => {
    renderApp(detailRoutes, '/assets/asset-1');
    const link = await screen.findByRole('link', { name: 'invoice-ast-0142.pdf' });
    expect(link).toHaveAttribute('href', '/api/v1/attachments/file-1');
    expect(link).toHaveAttribute('download');
    expect(screen.getByText('184 KB')).toBeInTheDocument();
  });

  it('offers the picker only the file types the server would accept', async () => {
    renderApp(detailRoutes, '/assets/asset-1');
    const input = await screen.findByLabelText('Upload attachment');
    // The same list the API refuses everything else against, so the browser
    // greys out a file the upload would only bounce.
    expect(input).toHaveAttribute('accept', ATTACHMENT_ACCEPT);
    expect(input.getAttribute('accept')).toContain('.pdf');
    expect(input.getAttribute('accept')).not.toContain('.svg');
  });

  it('hides the upload and remove affordances from a viewer', async () => {
    renderApp({ ...detailRoutes, ...viewer }, '/assets/asset-1');
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove invoice/i })).toBeNull();
  });
});

describe('the employee side', () => {
  it('lists holdings with a check-in affordance, and past ones with their outcome', async () => {
    renderApp(detailRoutes, '/employees/emp-1');

    expect(await screen.findByText('Currently holding · 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check in →' })).toBeInTheDocument();
    expect(screen.getByText('MacBook Air M2')).toBeInTheDocument();
    expect(screen.getByText(/Apr 2023 → Jan 2024 · offboarded/)).toBeInTheDocument();
  });

  it('checks a holding in without leaving the page', async () => {
    const api = renderApp(
      { ...detailRoutes, 'POST /assets/asset-1/checkin': { body: { asset: LAPTOP } } },
      '/employees/emp-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Check in →' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Check in AST-0142');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Check in asset' }));

    await waitFor(() => expect(api.called('POST /assets/asset-1/checkin')).toBeDefined());
  });

  it('assigns from the person, picking an asset instead of a person', async () => {
    const spare = { ...MONITOR, status: 'available' };
    const api = renderApp(
      {
        ...detailRoutes,
        'GET /assets': { body: { assets: [LAPTOP, spare] } },
        'POST /assets/asset-2/assign': { body: { asset: spare } },
      },
      '/employees/emp-1',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Assign asset' }));

    const dialog = await screen.findByRole('dialog');
    // Only free assets are offered — the laptop Maya already holds is not.
    expect(within(dialog).queryByRole('option', { name: /MacBook Pro/ })).toBeNull();
    await userEvent.click(await within(dialog).findByRole('option', { name: /Dell U2723QE/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign asset' }));

    await waitFor(() => expect(api.called('POST /assets/asset-2/assign')).toBeDefined());
    expect(api.called('POST /assets/asset-2/assign')!.body).toMatchObject({ employeeId: 'emp-1' });
  });

  it('does not offer to hand assets to somebody who is leaving', async () => {
    renderApp(
      {
        ...detailRoutes,
        'GET /employees/emp-1': {
          body: {
            ...MAYA_DETAIL,
            employee: { ...MAYA_DETAIL.employee, status: 'offboarding' },
          },
        },
      },
      '/employees/emp-1',
    );
    await screen.findByRole('heading', { name: 'Maya Lindqvist' });
    expect(screen.queryByRole('button', { name: 'Assign asset' })).toBeNull();
  });
});

describe('managing custom fields', () => {
  it('adds a field and says which key values will hang off', async () => {
    const api = renderApp(
      { ...detailRoutes, 'POST /custom-fields': { body: { customField: {} } } },
      '/assets/asset-1',
    );
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });
    await userEvent.click(screen.getByRole('button', { name: 'Manage fields' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('mdm_enrolled');
    await userEvent.type(within(dialog).getByLabelText(/new field/i), 'Warranty provider');
    await choose(within(dialog), /type/i, 'Text');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));

    await waitFor(() => expect(api.called('POST /custom-fields')).toBeDefined());
    expect(api.called('POST /custom-fields')!.body).toEqual({
      label: 'Warranty provider',
      type: 'text',
    });
  });

  it('warns that deleting takes the values, and only then deletes', async () => {
    const api = renderApp(
      { ...detailRoutes, 'DELETE /custom-fields/cf-2': { status: 204 } },
      '/assets/asset-1',
    );
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });
    await userEvent.click(screen.getByRole('button', { name: 'Manage fields' }));

    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText('hostname').closest('div')!.parentElement!.parentElement!;
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(api.called('DELETE /custom-fields/cf-2')).toBeUndefined();

    await userEvent.click(within(row).getByRole('button', { name: 'Delete values too' }));
    await waitFor(() => expect(api.called('DELETE /custom-fields/cf-2')).toBeDefined());
  });

  it('is not offered to a manager', async () => {
    renderApp(
      {
        ...detailRoutes,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/assets/asset-1',
    );
    await screen.findByRole('heading', { name: 'MacBook Pro 14"' });
    expect(screen.queryByRole('button', { name: 'Manage fields' })).toBeNull();
  });
});
