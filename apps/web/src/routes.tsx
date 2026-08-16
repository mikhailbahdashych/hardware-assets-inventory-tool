import { Navigate, Route, Routes } from 'react-router';
import { can } from '@inventory/shared';
import { useMe, useMeta } from './api/queries';
import { AppShell } from './components/app/AppShell';
import { Spinner } from './components/ui';
import { AssetDetailPage } from './features/assets/AssetDetailPage';
import { AssetsPage } from './features/assets/AssetsPage';
import { AcceptInvitePage } from './features/auth/AcceptInvitePage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { SetupPage } from './features/auth/SetupPage';
import { EmployeeDetailPage } from './features/employees/EmployeeDetailPage';
import { EmployeesPage } from './features/employees/EmployeesPage';
import { SectionPlaceholder } from './features/placeholder/SectionPlaceholder';

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

  if (meta.isPending || me.isPending) return <Splash />;

  if (meta.data?.needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  const member = me.data;
  if (!member) {
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

  return (
    <Routes>
      {/* Token screens stay reachable while signed in; they replace the session. */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<AppShell member={member} orgName={meta.data?.orgName ?? 'Inventory'} />}>
        <Route
          path="/dashboard"
          element={
            <SectionPlaceholder
              title="Dashboard"
              summary="Status counts, assets by category, recent activity, warranty expirations and pending returns arrive with the dashboard PR."
            />
          }
        />
        <Route path="/assets" element={<AssetsPage role={member.role} />} />
        <Route path="/assets/:id" element={<AssetDetailPage role={member.role} />} />
        <Route path="/employees" element={<EmployeesPage role={member.role} />} />
        <Route path="/employees/:id" element={<EmployeeDetailPage role={member.role} />} />
        <Route
          path="/members"
          element={
            <SectionPlaceholder
              title="Members"
              maxWidth={960}
              summary="Member roles and invitations arrive with the members PR."
            />
          }
        />
        <Route
          path="/admin/*"
          element={
            can(member.role, 'audit.view') ? (
              <SectionPlaceholder
                title="Admin"
                maxWidth={1060}
                summary="The activity log and workspace settings arrive with the admin PR."
              />
            ) : (
              <Navigate to="/dashboard" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
