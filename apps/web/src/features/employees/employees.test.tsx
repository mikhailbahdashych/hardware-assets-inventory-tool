import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_MEMBER, INVENTORY_ROUTES, LAPTOP, MAYA } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

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
  'GET /employees': { body: { employees: [DANIEL, MAYA] } },
  'GET /employees/emp-1': { body: { employee: MAYA } },
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
    renderApp(ROUTES, '/employees');
    await screen.findByText('Maya Lindqvist');

    await userEvent.type(screen.getByLabelText(/filter employees/i), 'engineering');
    await waitFor(() => expect(screen.queryByText('Maya Lindqvist')).toBeNull());
    expect(screen.getByText('Daniel Okafor')).toBeInTheDocument();
    expect(screen.getByText('1 employee')).toBeInTheDocument();
  });

  it('offers no way to add people to a viewer', async () => {
    renderApp(
      { ...ROUTES, 'GET /auth/me': { body: { member: { ...ADMIN_MEMBER, role: 'viewer' } } } },
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
    await userEvent.selectOptions(within(dialog).getByLabelText(/department/i), 'Design');
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
    await userEvent.selectOptions(within(dialog).getByLabelText(/department/i), 'Other…');

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
});

describe('employee detail', () => {
  it('lists what the person currently holds, derived from the asset list', async () => {
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

    await userEvent.selectOptions(within(dialog).getByLabelText(/status/i), 'offboarding');
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
