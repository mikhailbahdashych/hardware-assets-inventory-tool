import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES, AUDIT_PAGE, NO_SMTP_META, SETTINGS } from '@/test/api-stub';
import { renderApp, resetAppState } from '@/test/render';

afterEach(resetAppState);

describe('the activity log', () => {
  it('is where /admin lands', async () => {
    renderApp(ADMIN_ROUTES, '/admin');
    expect(await screen.findByRole('tab', { name: 'Activity log' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('renders each event as the sentence the shared renderer writes', async () => {
    renderApp(ADMIN_ROUTES, '/admin/activity');

    expect(
      await screen.findByText('Assigned MacBook Pro 14" to Maya Lindqvist'),
    ).toBeInTheDocument();
    expect(screen.getByText('Invited grace@acme.io as a Manager')).toBeInTheDocument();
    expect(
      screen.getByText("Started offboarding Liam O'Connor · 2 returns scheduled"),
    ).toBeInTheDocument();
  });

  it('stamps each row with its actor, time and type pill', async () => {
    renderApp(ADMIN_ROUTES, '/admin/activity');
    const row = (await screen.findByText('Invited grace@acme.io as a Manager')).closest(
      '[role="row"]',
    ) as HTMLElement;

    expect(within(row).getByText('Tomasz Kowalski')).toBeInTheDocument();
    expect(within(row).getByText('Aug 16 08:12')).toBeInTheDocument();
    expect(within(row).getByText('Auth')).toBeInTheDocument();
  });

  it('counts every pill and keeps the chosen one in the URL', async () => {
    const api = renderApp(ADMIN_ROUTES, '/admin/activity');

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
    renderApp(ADMIN_ROUTES, '/admin/activity?type=people');
    const link = await screen.findByRole('link', { name: /export log/i });
    expect(link).toHaveAttribute('href', '/api/v1/audit/export?type=people');
  });

  it('says how long events are kept, using the workspace setting', async () => {
    renderApp(ADMIN_ROUTES, '/admin/activity');
    expect(await screen.findByText('3 events · retained for 12 months')).toBeInTheDocument();
  });

  it('asks for more only while there are more to ask for', async () => {
    const api = renderApp(
      { ...ADMIN_ROUTES, 'GET /audit': { body: { ...AUDIT_PAGE, total: 240 } } },
      '/admin/activity',
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
    renderApp(ADMIN_ROUTES, '/admin/activity');
    await screen.findByText('Assigned MacBook Pro 14" to Maya Lindqvist');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });
});

describe('workspace settings', () => {
  it('shows what the workspace is set to', async () => {
    renderApp(ADMIN_ROUTES, '/admin/settings');

    expect(await screen.findByLabelText(/company name/i)).toHaveValue('Acme Corp');
    expect(screen.getByLabelText(/default currency/i)).toHaveValue('EUR');
    expect(screen.getByLabelText(/asset tag prefix/i)).toHaveValue('AST');
    expect(screen.getByLabelText(/warranty alert lead time/i)).toHaveValue('60');
    expect(screen.getByRole('switch', { name: /warranty alerts/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /weekly digest/i })).not.toBeChecked();
  });

  it('saves a renamed workspace when the field is left', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'PATCH /settings': { body: { settings: { ...SETTINGS, orgName: 'Globex' } } },
      },
      '/admin/settings',
    );

    const input = await screen.findByLabelText(/company name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Globex');
    await userEvent.tab();

    await waitFor(() => expect(api.called('PATCH /settings')).toBeDefined());
    expect(api.called('PATCH /settings')!.body).toEqual({ orgName: 'Globex' });
  });

  it('sends nothing when a field is left exactly as it was', async () => {
    const api = renderApp(ADMIN_ROUTES, '/admin/settings');
    const input = await screen.findByLabelText(/company name/i);
    await userEvent.click(input);
    await userEvent.tab();
    expect(api.called('PATCH /settings')).toBeUndefined();
  });

  it('saves a toggle the moment it is flipped', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'PATCH /settings': { body: { settings: { ...SETTINGS, emailWeeklyDigest: true } } },
      },
      '/admin/settings',
    );

    await userEvent.click(await screen.findByRole('switch', { name: /weekly digest/i }));
    await waitFor(() => expect(api.called('PATCH /settings')).toBeDefined());
    expect(api.called('PATCH /settings')!.body).toEqual({ emailWeeklyDigest: true });
  });

  it('keeps "Forever" a value rather than a missing retention', async () => {
    const api = renderApp(
      {
        ...ADMIN_ROUTES,
        'PATCH /settings': { body: { settings: { ...SETTINGS, logRetentionMonths: null } } },
      },
      '/admin/settings',
    );

    await userEvent.selectOptions(await screen.findByLabelText(/retention/i), 'null');
    await waitFor(() => expect(api.called('PATCH /settings')).toBeDefined());
    expect(api.called('PATCH /settings')!.body).toEqual({ logRetentionMonths: null });
  });
});

describe('an instance with no SMTP', () => {
  it('disables the email switches and says why, rather than lying about them', async () => {
    renderApp({ ...ADMIN_ROUTES, 'GET /meta': { body: NO_SMTP_META } }, '/admin/settings');

    const warranty = await screen.findByRole('switch', { name: /warranty alerts/i });
    expect(warranty).toBeDisabled();
    expect(screen.getAllByText('SMTP is not configured on this instance')).toHaveLength(4);

    // Everything that does not need email still works.
    expect(screen.getByLabelText(/company name/i)).toBeEnabled();
  });
});

describe('the danger zone', () => {
  it('will not delete until the organization name is typed back exactly', async () => {
    const api = renderApp(
      { ...ADMIN_ROUTES, 'POST /workspace/delete': { status: 204 } },
      '/admin/settings',
    );

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
