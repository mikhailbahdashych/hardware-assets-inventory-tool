import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MEMBER, DASHBOARD_ROUTES } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

const ASSET_CSV = [
  'asset_tag,name,category,serial_number,status',
  'AST-2001,MacBook Air M3,Laptops,C02ABC,Available',
  'AST-2002,Dell U2723QE,Monitors,CN0XYZ,Available',
].join('\n');

/** A file the dropzone's input will accept, as the browser would give it. */
function csvFile(contents: string, name = 'assets.csv') {
  return new File([contents], name, { type: 'text/csv' });
}

const OK_REPORT = {
  totalRows: 2,
  validCount: 2,
  createCount: 2,
  updateCount: 0,
  errors: [],
  warnings: [],
  errorsTruncated: false,
  warningsTruncated: false,
};

async function openWizard(routes = DASHBOARD_ROUTES, path = '/assets') {
  const api = renderApp(routes, path);
  await screen.findByRole('heading', { name: 'Assets' });
  await userEvent.click(screen.getByRole('button', { name: /import csv/i }));
  return { api, dialog: await screen.findByRole('dialog', { name: /import from csv/i }) };
}

describe('step 1 — the file', () => {
  it('offers the template for the kind being imported', async () => {
    const { dialog } = await openWizard();
    expect(within(dialog).getByRole('link', { name: /download template/i })).toHaveAttribute(
      'href',
      '/api/v1/import/template?kind=assets',
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Employees' }));
    expect(within(dialog).getByRole('link', { name: /download template/i })).toHaveAttribute(
      'href',
      '/api/v1/import/template?kind=employees',
    );
  });

  it('names the columns and marks the required ones', async () => {
    const { dialog } = await openWizard();
    expect(within(dialog).getByText('asset_tag *')).toBeInTheDocument();
    expect(within(dialog).getByText('serial_number')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/unknown assigned_to_email are imported as Unassigned/),
    ).toBeInTheDocument();
  });

  it('cannot continue until a file has been read', async () => {
    const { dialog } = await openWizard();
    expect(within(dialog).getByRole('button', { name: /continue to mapping/i })).toBeDisabled();

    await userEvent.upload(within(dialog).getByLabelText(/csv file/i), csvFile(ASSET_CSV));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /continue to mapping/i })).toBeEnabled(),
    );
    expect(within(dialog).getByText(/2 rows/)).toBeInTheDocument();
  });

  it('refuses a file with no data rows, rather than importing nothing', async () => {
    const { dialog } = await openWizard();
    await userEvent.upload(
      within(dialog).getByLabelText(/csv file/i),
      csvFile('asset_tag,name,category'),
    );
    expect(await within(dialog).findByText(/no data rows/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /continue to mapping/i })).toBeDisabled();
  });
});

describe('step 2 — the column mapping', () => {
  async function reachMapping(csv = ASSET_CSV) {
    const { api, dialog } = await openWizard();
    await userEvent.upload(within(dialog).getByLabelText(/csv file/i), csvFile(csv));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /continue to mapping/i })).toBeEnabled(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /continue to mapping/i }));
    return { api, dialog };
  }

  it('matches the headers it recognizes and previews what it read', async () => {
    const { dialog } = await reachMapping();

    expect(await within(dialog).findByRole('combobox', { name: 'asset_tag' })).toHaveTextContent(
      'asset_tag',
    );
    expect(within(dialog).getByRole('combobox', { name: 'category' })).toHaveTextContent(
      'category',
    );
    // Columns the file does not have are simply unmapped.
    expect(within(dialog).getByRole('combobox', { name: 'notes' })).toHaveTextContent(
      '— Not imported —',
    );
    // Three rows of preview, so a person can see the mapping is right.
    expect(within(dialog).getByText('MacBook Air M3')).toBeInTheDocument();
  });

  it('will not go on while a required column is unmapped', async () => {
    const { dialog } = await reachMapping(
      ['tag,name,category', 'AST-2001,MacBook Air M3,Laptops'].join('\n'),
    );

    const asset_tag = await within(dialog).findByRole('combobox', { name: 'asset_tag' });
    expect(asset_tag).toHaveTextContent('— Not imported —');
    expect(within(dialog).getByRole('button', { name: /check the file/i })).toBeDisabled();
    expect(within(dialog).getByText(/asset_tag is required/i)).toBeInTheDocument();

    // Pointing it at the right header is all it takes.
    await choose(within(dialog), 'asset_tag', 'tag');
    expect(within(dialog).getByRole('button', { name: /check the file/i })).toBeEnabled();
  });

  it('sends canonical rows, whatever the file called its columns', async () => {
    const { api, dialog } = await reachMapping(
      ['Tag,Name,Kind', 'AST-2001,MacBook Air M3,Laptops'].join('\n'),
    );

    // "Name" auto-matches; "Tag" and "Kind" are what a person has to point.
    expect(await within(dialog).findByRole('combobox', { name: 'name' })).toHaveTextContent('Name');
    await choose(within(dialog), 'asset_tag', 'Tag');
    await choose(within(dialog), 'category', 'Kind');
    await userEvent.click(within(dialog).getByRole('button', { name: /check the file/i }));

    await waitFor(() => expect(api.called('POST /import/validate')).toBeDefined());
    expect(api.called('POST /import/validate')!.body).toEqual({
      kind: 'assets',
      rows: [{ asset_tag: 'AST-2001', name: 'MacBook Air M3', category: 'Laptops' }],
    });
  });
});

describe('steps 3 to 5 — the dry run, the commit and the summary', () => {
  async function reachDryRun(routes: Parameters<typeof renderApp>[0]) {
    const { api, dialog } = await openWizard(routes);
    await userEvent.upload(within(dialog).getByLabelText(/csv file/i), csvFile(ASSET_CSV));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /continue to mapping/i })).toBeEnabled(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /continue to mapping/i }));
    await userEvent.click(await within(dialog).findByRole('button', { name: /check the file/i }));
    return { api, dialog };
  }

  it('reports what would happen and then writes it', async () => {
    const { api, dialog } = await reachDryRun({
      ...DASHBOARD_ROUTES,
      'POST /import/validate': { body: { report: OK_REPORT } },
      'POST /import/commit': { body: { kind: 'assets', created: 2, updated: 0 } },
    });

    expect(await within(dialog).findByText(/2 rows ready/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 assets to add/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /import 2 rows/i }));
    await waitFor(() => expect(api.called('POST /import/commit')).toBeDefined());
    expect(await within(dialog).findByText(/Added 2 assets/i)).toBeInTheDocument();
  });

  it('lists what is wrong, by row and column, and refuses to import', async () => {
    const { dialog } = await reachDryRun({
      ...DASHBOARD_ROUTES,
      'POST /import/validate': {
        body: {
          report: {
            ...OK_REPORT,
            validCount: 1,
            createCount: 1,
            errors: [
              { row: 3, column: 'category', message: '"Hovercraft" is not one of the categories.' },
            ],
          },
        },
      },
    });

    expect(await within(dialog).findByText(/Row 3/)).toBeInTheDocument();
    expect(within(dialog).getByText(/is not one of the categories/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Import/ })).toBeNull();
    expect(within(dialog).getByText(/Fix the file and try again/i)).toBeInTheDocument();
  });

  it('lets a warning through, having said what it will do', async () => {
    const { api, dialog } = await reachDryRun({
      ...DASHBOARD_ROUTES,
      'POST /import/validate': {
        body: {
          report: {
            ...OK_REPORT,
            warnings: [
              {
                row: 2,
                column: 'assigned_to_email',
                message: 'No employee has the address ghost@acme.io — imported as Available.',
              },
            ],
          },
        },
      },
      'POST /import/commit': { body: { kind: 'assets', created: 2, updated: 0 } },
    });

    expect(await within(dialog).findByText(/imported as Available/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /import 2 rows/i }));
    await waitFor(() => expect(api.called('POST /import/commit')).toBeDefined());
  });

  it('goes back to the mapping so a wrong column can be repointed', async () => {
    const { dialog } = await reachDryRun({
      ...DASHBOARD_ROUTES,
      'POST /import/validate': { body: { report: OK_REPORT } },
    });

    await within(dialog).findByText(/2 rows ready/i);
    await userEvent.click(within(dialog).getByRole('button', { name: /back/i }));
    expect(await within(dialog).findByLabelText('asset_tag')).toBeInTheDocument();
  });
});

describe('who may import', () => {
  it('is not offered to a viewer at all', async () => {
    renderApp(
      {
        ...DASHBOARD_ROUTES,
        'GET /auth/me': { body: { member: { ...ADMIN_MEMBER, role: 'viewer' } } },
      },
      '/assets',
    );
    await screen.findByRole('heading', { name: 'Assets' });
    expect(screen.queryByRole('button', { name: /import csv/i })).toBeNull();
  });
});
