import { Outlet, useNavigate } from 'react-router';
import { useLogout } from '@/api/mutations';
import type { Member } from '@/types/api';
import { BreadcrumbDetailProvider } from '@/providers/BreadcrumbProvider';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAdoptMemberPrefs } from './useThemeControls';

/** Sidebar + topbar frame; only the content column scrolls. */
export function AppShell({ member, orgName }: { member: Member; orgName: string }) {
  const logout = useLogout();
  const navigate = useNavigate();
  useAdoptMemberPrefs(member);

  return (
    <BreadcrumbDetailProvider>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar
          member={member}
          orgName={orgName}
          onSignOut={() => logout.mutate(undefined, { onSuccess: () => navigate('/login') })}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Topbar />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Outlet />
          </div>
        </div>
      </div>
    </BreadcrumbDetailProvider>
  );
}
