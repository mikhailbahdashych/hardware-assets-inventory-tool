import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN_MEMBER,
  ADMIN_ROUTES,
  AUDIT_PAGE,
  MANAGER_ACTIONS,
  NO_SMTP_META,
  session,
  SETTINGS,
} from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';
import { choose } from '@/test/dropdown';

afterEach(resetAppState);

describe('the activity log', () => {
  it('is a page of its own, not a tab inside Admin', async () => {
    renderApp(ADMIN_ROUTES, '/activity');

    expect(await screen.findByRole('heading', { name: 'Activity log' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    // Settings live next door, and neither page carries the other's controls.
    expect(screen.queryByLabelText(/company name/i)).toBeNull();
    expect(screen.getByRole('link', { name: 'Activity log' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('is out of reach for anyone who cannot read it', async () => {
    renderApp(
      {
        ...ADMIN_ROUTES,
        'GET /auth/me': session({ ...ADMIN_MEMBER, role: 'manager' }, MANAGER_ACTIONS),
      },
      '/activity',
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: 'Activity log' })).toBeNull();
  });

  it('still answers the URL the tabs used to have, filter and all', async () => {
    renderApp(ADMIN_ROUTES, '/admin/activity?type=auth');

    expect(await screen.findByRole('heading', { name: 'Activity log' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Auth 1' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('renders each event as the sentence the shared renderer writes', async () => {
    renderApp(ADMIN_ROUTES, '/activity');

    expect(
      await screen.findByText('Assigned MacBook Pro 14" to Maya Lindqvist'),
    ).toBeInTheDocument();
    expect(screen.getByText('Invited grace@acme.io as a Manager')).toBeInTheDocument();
    expect(
      screen.getByText("Started offboarding Liam O'Connor · 2 returns scheduled"),
    ).toBeInTheDocument();
  });

  it('stamps each row with its actor, time and type pill', async () => {
    renderApp(ADMIN_ROUTES, '/activity');
    const row = (await screen.findByText('Invited grace@acme.io as a Manager')).closest(
      '[role="row"]',
    ) as HTMLElement;

    expect(within(row).getByText('Tomasz Kowalski')).toBeInTheDocument();
    expect(within(row).getByText('Aug 16 08:12')).toBeInTheDocument();
    expect(within(row).getByText('Auth')).toBeInTheDocument();
  });

  it('counts every pill and keeps the chosen one in the URL', async () => {
    const api = renderApp(ADMIN_ROUTES, '/activity');

    expect(await screen.findByRole('button', { name: 'All 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System 0' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Assets 1' }));
    await waitFor(() =>
      expect(api.calledAll('GET /audit').some((call) => call.search.includes('type=assets'))).toBe(
        true,
      ),
    );
  });

  it('offers a download of exactly what is on screen', async () => {
    renderApp(ADMIN_ROUTES, '/activity?type=people');
    const link = await screen.findByRole('link', { name: /export log/i });
    expect(link).toHaveAttribute('href', '/api/v1/audit/export?type=people');
  });

  it('says how long events are kept, using the workspace setting', async () => {
    renderApp(ADMIN_ROUTES, '/activity');
    expect(await screen.findByText('3 events · retained for 12 months')).toBeInTheDocument();
  });

  it('asks for more only while there are more to ask for', async () => {
    const api = renderApp(
      { ...ADMIN_ROUTES, 'GET /audit': { body: { ...AUDIT_PAGE, total: 240 } } },
      '/activity',
    );

    const more = await screen.findByRole('button', { name: /load more/i });
    await userEvent.click(more);
    await waitFor(() =>
      expect(api.calledAll('GET /audit').some((call) => call.search.includes('limit=400'))).toBe(
        true,
      ),
    );
  });

  it('has nothing to load when the log fits on one page', async () => {
    renderApp(ADMIN_ROUTES, '/activity');
    await screen.findByText('Assigned MacBook Pro 14" to Maya Lindqvist');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });
});

describe('workspace settings', () => {
  it('shows what the workspace is set to', async () => {
    renderApp(ADMIN_ROUTES, '/admin');

    expect(await screen.findByLabelText(/company name/i)).toHaveValue('Acme Corp');
    expect(screen.getByRole('combobox', { name: /default currency/i })).toHaveTextContent(
      'EUR (€)',
    );
    expect(screen.getByLabelText(/asset tag prefix/i)).toHaveValue('AST');
    expect(screen.getByLabelText(/warranty alert lead time/i)).toHaveValue(60);
    expect(screen.getByRole('switch', { name: /warranty alerts/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /weekly digest/i })).not.toBeChecked();
  });

  it('still answers the old settings URL', async () => {
    renderApp(ADMIN_ROUTES, '/admin/settings');
    expect(await screen.findByLabelText(/company name/i)).toHaveValue('Acme Corp');
  });

  it('has nothing to save until something is changed', async () => {
    const api = renderApp(ADMIN_ROUTES, '/admin');

    const save = await screen.findByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();
    expect(screen.getByText('Everything here is saved')).toBeInTheDocument();

    // Typing the same value back is not a change.
    const input = screen.getByLabelText(/company name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Acme Corp');
    expect(save).toBeDisabled();

    await userEvent.type(input, '!');
    expect(save).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(api.called('PATCH /settings')).toBeUndefined();
  });

  it('sends every edit together, only when Save is pressed', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'PATCH /settings': {
          body: { settings: { ...SETTINGS, orgName: 'Globex', emailWeeklyDigest: true } },
        },
      },
      '/admin',
    );

    const input = await screen.findByLabelText(/company name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Globex');
    await userEvent.click(screen.getByRole('switch', { name: /weekly digest/i }));
    // Leaving a field is not a save: nothing has been sent yet.
    await userEvent.tab();
    expect(api.called('PATCH /settings')).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.called('PATCH /settings')).toBeDefined());
    expect(api.called('PATCH /settings')!.body).toEqual({
      orgName: 'Globex',
      emailWeeklyDigest: true,
    });
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
  });

  it('puts every field back the way it was when the edits are discarded', async () => {
    const api = renderApp(ADMIN_ROUTES, '/admin');

    const input = await screen.findByLabelText(/company name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Globex');
    await choose(screen, /default currency/i, 'USD ($)');

    await userEvent.click(screen.getByRole('button', { name: /discard/i }));

    expect(input).toHaveValue('Acme Corp');
    expect(screen.getByRole('combobox', { name: /default currency/i })).toHaveTextContent(
      'EUR (€)',
    );
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    expect(api.called('PATCH /settings')).toBeUndefined();
  });

  it('lets an admin pick any lead time, not one of three', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'PATCH /settings': { body: { settings: { ...SETTINGS, warrantyLeadDays: 45 } } },
      },
      '/admin',
    );

    const lead = await screen.findByLabelText(/warranty alert lead time/i);
    await userEvent.clear(lead);
    await userEvent.type(lead, '45');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.called('PATCH /settings')).toBeDefined());
    expect(api.called('PATCH /settings')!.body).toEqual({ warrantyLeadDays: 45 });
  });

  it('lets the server name a lead time it will not accept', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'PATCH /settings': {
          status: 422,
          body: {
            error: {
              code: 'validation_failed',
              message: 'Check the highlighted fields.',
              fields: { warrantyLeadDays: 'At most 365 days of notice.' },
            },
          },
        },
      },
      '/admin',
    );

    const lead = await screen.findByLabelText(/warranty alert lead time/i);
    await userEvent.clear(lead);
    await userEvent.type(lead, '900');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('At most 365 days of notice.')).toBeInTheDocument();
    expect(api.called('PATCH /settings')!.body).toEqual({ warrantyLeadDays: 900 });
  });

  it('says how much of the attachment storage is gone, and takes a new limit', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'GET /settings': { body: { settings: SETTINGS, storageUsedBytes: 1_288_490_188 } },
        'PATCH /settings': { body: { settings: { ...SETTINGS, uploadQuotaMb: 4096 } } },
      },
      '/admin',
    );

    expect(await screen.findByText(/1\.2 GB of 2 GB used/)).toBeInTheDocument();

    const quota = screen.getByLabelText(/attachment storage/i);
    expect(quota).toHaveValue(2048);
    await userEvent.clear(quota);
    await userEvent.type(quota, '4096');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.called('PATCH /settings')).toBeDefined());
    expect(api.called('PATCH /settings')!.body).toEqual({ uploadQuotaMb: 4096 });
  });

  it('keeps "Forever" a value rather than a missing retention', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'PATCH /settings': { body: { settings: { ...SETTINGS, logRetentionMonths: null } } },
      },
      '/admin',
    );

    await screen.findByRole('combobox', { name: /retention/i });
    await choose(screen, /retention/i, 'Forever');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(api.called('PATCH /settings')).toBeDefined());
    expect(api.called('PATCH /settings')!.body).toEqual({ logRetentionMonths: null });
  });
});

describe('an instance with no SMTP', () => {
  it('disables the email switches and says why, rather than lying about them', async () => {
    renderApp({ ...ADMIN_ROUTES, 'GET /meta': { body: NO_SMTP_META } }, '/admin');

    const warranty = await screen.findByRole('switch', { name: /warranty alerts/i });
    expect(warranty).toBeDisabled();
    expect(screen.getAllByText('SMTP is not configured on this instance')).toHaveLength(4);

    // Everything that does not need email still works.
    expect(screen.getByLabelText(/company name/i)).toBeEnabled();
  });
});

describe('the danger zone', () => {
  it('will not delete until the organization name is typed back exactly', async () => {
    const api = renderApp({ ...ADMIN_ROUTES, 'POST /workspace/delete': { status: 204 } }, '/admin');

    await userEvent.click(await screen.findByRole('button', { name: /^delete…$/i }));
    const confirm = screen.getByRole('button', { name: /delete workspace/i });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/type acme corp/i), 'acme corp');
    expect(confirm).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/type acme corp/i));
    await userEvent.type(screen.getByLabelText(/type acme corp/i), 'Acme Corp');
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    await waitFor(() => expect(api.called('POST /workspace/delete')).toBeDefined());
    expect(api.called('POST /workspace/delete')!.body).toEqual({ confirmText: 'Acme Corp' });
  });
});
