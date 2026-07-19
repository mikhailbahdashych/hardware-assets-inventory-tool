import { Routes } from '@angular/router';
import { UserRole } from '@inventory/shared';
import {
  authGuard,
  loginRedirectGuard,
  mfaEnrollmentGuard,
  mustChangePasswordGuard,
  roleGuard,
  setupGuard,
} from './core/guards/auth.guards';

export const routes: Routes = [
  {
    path: 'setup',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/auth/setup-page').then((m) => m.SetupPage),
  },
  {
    path: 'login',
    canActivate: [loginRedirectGuard],
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'change-password',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/auth/change-password-page').then((m) => m.ChangePasswordPage),
  },
  {
    path: 'mfa-setup',
    canActivate: [authGuard],
    loadComponent: () => import('./features/auth/mfa-setup-page').then((m) => m.MfaSetupPage),
  },
  {
    path: '',
    canActivate: [authGuard, mustChangePasswordGuard, mfaEnrollmentGuard],
    loadComponent: () => import('./core/layout/shell').then((m) => m.Shell),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
      },
      {
        path: 'admin/users',
        canActivate: [roleGuard(UserRole.ADMIN)],
        loadComponent: () => import('./features/admin/users/users-page').then((m) => m.UsersPage),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: '' },
];
