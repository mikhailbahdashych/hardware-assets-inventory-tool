import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { APP_NAME, UserRole } from '@inventory/shared';
import { AuthStore } from '../auth/auth.store';

interface NavItem {
  label: string;
  icon: string;
  path: string;
  /** Roles that see this item; undefined = everyone. */
  roles?: UserRole[];
  /** Not yet routable (later phases). */
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'dashboard', path: '/dashboard' },
  { label: 'Assets', icon: 'devices', path: '/assets', disabled: true },
  { label: 'Employees', icon: 'group', path: '/employees', disabled: true },
  { label: 'Assignments', icon: 'assignment_ind', path: '/assignments', disabled: true },
  {
    label: 'Users',
    icon: 'manage_accounts',
    path: '/admin/users',
    roles: [UserRole.ADMIN],
  },
  {
    label: 'Asset types',
    icon: 'category',
    path: '/admin/asset-types',
    roles: [UserRole.ADMIN],
    disabled: true,
  },
  {
    label: 'Audit log',
    icon: 'history',
    path: '/admin/audit',
    roles: [UserRole.ADMIN],
    disabled: true,
  },
];

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatMenuModule,
    MatSidenavModule,
    MatToolbarModule,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly appName = APP_NAME;
  protected readonly user = this.store.user;
  protected readonly navItems = computed(() => {
    const role = this.store.user()?.role;
    return NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));
  });

  protected async logout(): Promise<void> {
    await this.store.logout();
    await this.router.navigate(['/login']);
  }
}
