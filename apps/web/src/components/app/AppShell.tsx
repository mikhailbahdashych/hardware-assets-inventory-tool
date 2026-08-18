import { useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { useLogout } from '@/api/mutations';
import { BreadcrumbDetailProvider } from '@/providers/BreadcrumbProvider';
import { ModalProvider, useModals } from '@/providers/ModalProvider';
import { useHotkey } from '@/lib/useHotkey';
import { ModalHost } from './ModalHost';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAdoptMemberPrefs } from './useThemeControls';
import type { AppShellProps } from './types/appShell';

/** Sidebar + topbar frame; only the content column scrolls. */
export function AppShell({ member, permissions, orgName }: AppShellProps) {
  const logout = useLogout();
  const navigate = useNavigate();
  useAdoptMemberPrefs(member);

  return (
    <BreadcrumbDetailProvider>
      <ModalProvider>
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
          <Sidebar
            member={member}
            permissions={permissions}
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
        <PaletteHotkey />
        <ModalHost member={member} permissions={permissions} />
      </ModalProvider>
    </BreadcrumbDetailProvider>
  );
}

/**
 * ⌘K anywhere inside the shell. A separate component so the hotkey lives under
 * the provider it needs — and so re-registering it never re-renders the shell.
 */
function PaletteHotkey() {
  const { openModal } = useModals();
  useHotkey(
    'k',
    useCallback(() => openModal('palette'), [openModal]),
  );
  return null;
}
