import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { UserRole } from '@inventory/shared';
import { AuthStore } from '../auth/auth.store';
import { AuthApi } from '../auth/auth.api';

/** Guarded area: unknown → try session restore; anon → /login. */
export const authGuard: CanActivateFn = async () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  if (store.status() === 'unknown') await store.init();
  return store.status() === 'authed' ? true : router.createUrlTree(['/login']);
};

/** Login bounces authed users to the dashboard — and virgin instances to setup. */
export const loginRedirectGuard: CanActivateFn = async () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  const api = inject(AuthApi);
  if (store.status() === 'unknown') await store.init();
  if (store.status() === 'authed') return router.createUrlTree(['/dashboard']);
  const { setupRequired } = await firstValueFrom(api.setupStatus());
  return setupRequired ? router.createUrlTree(['/setup']) : true;
};

/** Setup page is only reachable while the instance has no users. */
export const setupGuard: CanActivateFn = async () => {
  const api = inject(AuthApi);
  const router = inject(Router);
  const { setupRequired } = await firstValueFrom(api.setupStatus());
  return setupRequired ? true : router.createUrlTree(['/login']);
};

/** Users flagged for a password change are pinned to that page. */
export const mustChangePasswordGuard: CanActivateFn = () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  return store.user()?.mustChangePassword ? router.createUrlTree(['/change-password']) : true;
};

/** Route factory: restrict to the given roles (others land on the dashboard). */
export const roleGuard =
  (...roles: UserRole[]): CanActivateFn =>
  () => {
    const store = inject(AuthStore);
    const router = inject(Router);
    const role = store.user()?.role;
    return role && roles.includes(role) ? true : router.createUrlTree(['/dashboard']);
  };
