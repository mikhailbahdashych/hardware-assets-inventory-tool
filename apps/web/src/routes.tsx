import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { can } from '@inventory/shared';
import { orgMeta, useMe, useMeta } from './api/queries';
import { AppShell } from './components/app/AppShell';
import { Spinner } from './components/ui';
import { ActivityLogPage } from './features/admin/ActivityLogPage';
import { AdminPage } from './features/admin/AdminPage';
import { AssetDetailPage } from './features/assets/AssetDetailPage';
import { AssetsPage } from './features/assets/AssetsPage';
import { AcceptInvitePage } from './features/auth/AcceptInvitePage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { MfaEnrollPage } from './features/auth/MfaEnrollPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { SetupPage } from './features/auth/SetupPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { EmployeeDetailPage } from './features/employees/EmployeeDetailPage';
import { EmployeesPage } from './features/employees/EmployeesPage';
import { MembersPage } from './features/members/MembersPage';
import { RolesPage } from './features/roles/RolesPage';
import { WorkflowPage } from './features/workflow/WorkflowPage';

/**
 * The design-system review page. `import.meta.env.DEV` is statically false in a
 * production build, so the chunk is dropped entirely rather than shipped and
 * guarded. It sits above the three route sets below because reviewing a
 * primitive should not require a workspace, a session or a role.
 */
const KitchenSink = import.meta.env.DEV
  ? lazy(() => import('./features/dev/KitchenSink').then((m) => ({ default: m.KitchenSink })))
  : null;

/** `/admin/activity?type=auth` was a shareable link; the filter travels with it. */
function LegacyActivityRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/activity${search}`} replace />;
}

function Splash() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Spinner size={20} />
    </div>
  );
}

/**
 * Three route sets, chosen by instance and session state: an uninitialized
 * instance can only reach setup; a signed-out visitor only the auth screens;
 * everyone else gets the app shell.
 */
export function AppRoutes() {
  const meta = useMeta();
  const me = useMe();
  const { pathname } = useLocation();

  // Ahead of all three: the review page reads no data and needs no session, so
  // waiting on /meta to look at a Button would be absurd — and it must not be
  // swallowed by the signed-out set's catch-all redirect to /login.
  if (KitchenSink && pathname === '/kitchen-sink') {
    return (
      <Suspense fallback={<Splash />}>
        <KitchenSink />
      </Suspense>
    );
  }

  if (meta.isPending || me.isPending) return <Splash />;

  // Every route set below depends on knowing whether this instance is set up.
  // Guessing "signed out" when /meta failed would send an uninitialized
  // instance to a login screen nobody can pass.
  if (!meta.data) {
    throw new Error('GET /api/v1/meta has not answered, so no route set can be chosen.');
  }

  if (meta.data.needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  const session = me.data;
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const { member } = session;

  /**
   * A fourth state, between signed out and signed in: the workspace requires a
   * second factor and this member has not set one up. There is exactly one
   * screen, and no way past it — the API refuses everything else with
   * `mfa_enrolment_required`, so a router that let them through would only
   * produce a page of failed requests.
   */
  if (session.mustEnrolMfa) {
    return (
      <Routes>
        <Route path="*" element={<MfaEnrollPage member={member} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Token screens stay reachable while signed in; they replace the session. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<AppShell member={member} orgName={orgMeta(meta.data).orgName} />}>
        <Route path="/dashboard" element={<DashboardPage member={member} />} />
        <Route path="/assets" element={<AssetsPage role={member.role} />} />
        <Route path="/assets/:id" element={<AssetDetailPage role={member.role} />} />
        <Route path="/employees" element={<EmployeesPage role={member.role} />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage role={member.role} />} />
        <Route path="/members" element={<MembersPage role={member.role} memberId={member.id} />} />
        {/* Reading what happened and changing how the workspace behaves are
            different jobs, so they are different pages rather than two tabs. */}
        <Route
          path="/activity"
          element={
            can(member.role, 'audit.view') ? (
              <ActivityLogPage />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        {/* The vocabulary the whole app renders through, so it is its own page
            rather than a card on Admin. */}
        <Route
          path="/workflow"
          element={
            can(member.role, 'workflow.manage') ? (
              <WorkflowPage />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        {/* Who may do what, for the same reason: it is workspace vocabulary
            the whole app reads, not a setting on a form. */}
        <Route
          path="/roles"
          element={
            can(member.role, 'roles.manage') ? (
              <RolesPage ownRole={member.role} />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        <Route
          path="/admin"
          element={
            can(member.role, 'settings.manage') ? (
              <AdminPage />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        {/* The tabs shipped, so their URLs exist in somebody's history. */}
        <Route path="/admin/activity" element={<LegacyActivityRedirect />} />
        <Route path="/admin/settings" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
