import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_MEMBER,
  DB_DOWN,
  employeesRoute,
  INVENTORY_ROUTES,
  LAPTOP,
  MANAGER_ACTIONS,
  MAYA,
  MAYA_DETAIL,
  session,
  VIEWER_ACTIONS,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

afterEach(() => {
  vi.unstubAllGlobals();
  resetAppState();
});

const DANIEL = {
  ...MAYA,
  id: 'emp-2',
  firstName: 'Daniel',
  lastName: 'Okafor',
  displayName: 'Daniel Okafor',
  email: 'daniel.okafor@acme.io',
  jobTitle: 'Backend Engineer',
  department: 'Engineering',
  location: 'Lisbon',
  activeAssetCount: 0,
};

const ROUTES = {
  ...INVENTORY_ROUTES,
  // The list is searched and paged on the server, so the stub answers the way
  // the endpoint does rather than handing back the whole fixture every time.
  'GET /employees': employeesRoute([DANIEL, MAYA]),
  'GET /employees/emp-1': { body: MAYA_DETAIL },
};

describe('employee list', () => {
  it('shows each person with their department, holdings count and status', async () => {
    renderApp(ROUTES, '/employees');

    expect(await screen.findByText('Maya Lindqvist')).toBeInTheDocument();
    expect(screen.getByText('Product Designer')).toBeInTheDocument();
    expect(screen.getByText('maya.lindqvist@acme.io')).toBeInTheDocument();
    expect(screen.getByText('Stockholm')).toBeInTheDocument();
    expect(screen.getAllByText('Active')).not.toHaveLength(0);
    expect(screen.getByText('2 employees')).toBeInTheDocument();
  });

  it('filters by name, email or department', async () => {
    const api = renderApp(ROUTES, '/employees');
    await screen.findByText('Maya Lindqvist');

    await userEvent.type(screen.getByLabelText(/filter employees/i), 'engineering');
    await waitFor(() => expect(screen.queryByText('Maya Lindqvist')).toBeNull());
    expect(screen.getByText('Daniel Okafor')).toBeInTheDocument();
    expect(screen.getByText('1 employee')).toBeInTheDocument();
    // The matching is the server's; the browser only carries the needle there.
    expect(api.calledAll('GET /employees').at(-1)!.search).toContain('q=engineering');
  });

  it('asks for one page at a time and pages through the rest', async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...MAYA,
      id: `emp-${index}`,
      displayName: `Person ${String(index).padStart(3, '0')}`,
      email: `person${index}@acme.io`,
    }));
    const api = renderApp({ ...ROUTES, 'GET /employees': employeesRoute(many) }, '/employees');
    await screen.findByText('Person 000');

    expect(screen.getByText('120 employees')).toBeInTheDocument();
    expect(api.called('GET /employees')!.search).toContain('limit=50');

    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(screen.getByText('Person 050')).toBeInTheDocument());
    expect(api.calledAll('GET /employees').at(-1)!.search).toContain('offset=50');
  });

  it('offers no way to add people to a viewer', async () => {
    renderApp(
      { ...ROUTES, 'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'viewer' }, VIEWER_ACTIONS) },
      '/employees',
    );
    await screen.findByText('Maya Lindqvist');
    expect(screen.queryByRole('button', { name: /add employee/i })).toBeNull();
  });

  it('adds a person and lowercases nothing the server does not', async () => {
    const api = renderApp(
      { ...ROUTES, 'POST /employees': { body: { employee: DANIEL } } },
      '/employees',
    );
    await screen.findByText('Maya Lindqvist');

    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/first name/i), 'Sofia');
    await userEvent.type(within(dialog).getByLabelText(/last name/i), 'Reyes');
    await userEvent.type(within(dialog).getByLabelText(/work email/i), 'sofia.reyes@acme.io');
    await choose(within(dialog), /department/i, 'Design');
    await userEvent.click(within(dialog).getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(api.called('POST /employees')).toBeDefined());
    expect(api.called('POST /employees')!.body).toMatchObject({
      firstName: 'Sofia',
      lastName: 'Reyes',
      email: 'sofia.reyes@acme.io',
      department: 'Design',
      jobTitle: null,
    });
  });

  it('reveals a free-text department behind "Other…"', async () => {
    renderApp(ROUTES, '/employees');
    await screen.findByText('Maya Lindqvist');

    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
    const dialog = await screen.findByRole('dialog');
    await choose(within(dialog), /department/i, 'Other…');

    const field = within(dialog).getByLabelText(/department/i);
    expect(field.tagName).toBe('INPUT');
    await userEvent.type(field, 'Workplace Ops');
    expect(field).toHaveValue('Workplace Ops');
  });

  it('shows a duplicate-email error under its input', async () => {
    renderApp(
      {
        ...ROUTES,
        'POST /employees': {
          status: 422,
          body: {
            error: {
              code: 'validation',
              message: 'Please correct the highlighted fields.',
              fields: { email: 'Another employee already uses that email address.' },
            },
          },
        },
      },
      '/employees',
    );
    await screen.findByText('Maya Lindqvist');

    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/first name/i), 'Sofia');
    await userEvent.type(within(dialog).getByLabelText(/last name/i), 'Reyes');
    await userEvent.type(within(dialog).getByLabelText(/work email/i), 'maya.lindqvist@acme.io');
    await userEvent.click(within(dialog).getByRole('button', { name: /add employee/i }));

    expect(await within(dialog).findByText(/already uses that email/i)).toBeInTheDocument();
  });

  it('can invite the new person as a member in the same breath', async () => {
    const created = { ...MAYA, id: 'emp-9', displayName: 'Sofia Reyes', email: 'sofia@acme.io' };
    const api = renderApp(
      {
        ...ROUTES,
        'POST /employees': { body: { employee: created } },
        'POST /members/invites': {
          body: { member: {}, inviteUrl: 'http://localhost:3000/accept-invite?token=xyz' },
        },
      },
      '/employees',
    );
    await screen.findByText('Maya Lindqvist');

    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/first name/i), 'Sofia');
    await userEvent.type(within(dialog).getByLabelText(/last name/i), 'Reyes');
    await userEvent.type(within(dialog).getByLabelText(/work email/i), 'sofia@acme.io');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /also invite/i }));
    await choose(within(dialog), /^role$/i, /Manager/);
    await userEvent.click(within(dialog).getByRole('button', { name: /add employee/i }));

    await waitFor(() => expect(api.called('POST /members/invites')).toBeDefined());
    // The invite links itself to the record that was just created, which is
    // the whole point of doing both here rather than on two screens.
    expect(api.called('POST /members/invites')!.body).toEqual({
      email: 'sofia@acme.io',
      role: 'manager',
      employeeId: 'emp-9',
    });
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(
      'http://localhost:3000/accept-invite?token=xyz',
    );
  });

  it('hides the invite section from a role that cannot invite', async () => {
    renderApp(
      {
        ...ROUTES,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/employees',
    );
    await screen.findByText('Maya Lindqvist');

    await userEvent.click(screen.getByRole('button', { name: /add employee/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox', { name: /also invite/i })).toBeNull();
  });
});

describe('employee detail', () => {
  it('lists what the person currently holds', async () => {
    renderApp(ROUTES, '/employees/emp-1');

    expect(await screen.findByRole('heading', { name: 'Maya Lindqvist' })).toBeInTheDocument();
    expect(
      screen.getByText('Product Designer · Design · Stockholm · maya.lindqvist@acme.io'),
    ).toBeInTheDocument();
    expect(screen.getByText('Currently holding · 1')).toBeInTheDocument();
    expect(screen.getByText(LAPTOP.name)).toBeInTheDocument();
    expect(screen.getByText('Employees / Maya Lindqvist')).toBeInTheDocument();
  });

  it('asks for a return date when offboarding starts', async () => {
    const api = renderApp(
      { ...ROUTES, 'PATCH /employees/emp-1': { body: { employee: MAYA } } },
      '/employees/emp-1',
    );
    await screen.findByRole('heading', { name: 'Maya Lindqvist' });

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/return due/i)).toBeNull();

    await choose(within(dialog), /status/i, 'Offboarding');
    const returnDue = await within(dialog).findByLabelText(/return due/i);
    await userEvent.type(returnDue, '2026-08-23');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.called('PATCH /employees/emp-1')).toBeDefined());
    expect(api.called('PATCH /employees/emp-1')!.body).toMatchObject({
      status: 'offboarding',
      returnDueDate: '2026-08-23',
    });
  });

  it('says plainly when the person does not exist', async () => {
    renderApp(
      {
        ...ROUTES,
        'GET /employees/emp-9': {
          status: 404,
          body: { error: { code: 'not_found', message: 'That employee could not be found.' } },
        },
      },
      '/employees/emp-9',
    );
    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
  });
});

describe('a read that failed', () => {
  it('says so in the server’s own words instead of an empty payroll', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /employees': DB_DOWN }, '/employees');

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText(/the employee list could not be loaded/i)).toBeInTheDocument();
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // The lie: a failed read drawn as a company with nobody in it.
    expect(screen.queryByText(/no employees yet/i)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Rows per page' })).toBeNull();
  });

  it('reads the list again when the panel’s retry is pressed', async () => {
    let attempts = 0;
    const api = renderApp(
      {
        ...INVENTORY_ROUTES,
        'GET /employees': (body, search) =>
          attempts++ === 0 ? DB_DOWN : employeesRoute([MAYA])(body, search),
      },
      '/employees',
    );

    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Maya Lindqvist')).toBeInTheDocument();
    expect(api.calledAll('GET /employees')).toHaveLength(2);
  });

  it('still says the list is empty when it genuinely is', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /employees': employeesRoute([]) }, '/employees');

    expect(await screen.findByText(/no employees yet/i)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the way back when one person cannot be read', async () => {
    renderApp({ ...INVENTORY_ROUTES, 'GET /employees/emp-1': DB_DOWN }, '/employees/emp-1');

    const panel = await screen.findByRole('alert');
    expect(within(panel).getByText(/this employee could not be loaded/i)).toBeInTheDocument();
    expect(within(panel).getByText('The database is unavailable.')).toBeInTheDocument();
    // The bespoke panel this replaces had one thing worth keeping: a way out
    // of a page that cannot draw itself.
    // Two of them now: the sidebar's, and the page's own way out of a
    // screen that cannot draw itself — the one thing the bespoke panel
    // this replaces had worth keeping.
    expect(screen.getAllByRole('link', { name: 'Employees' })).toHaveLength(2);
  });
});
