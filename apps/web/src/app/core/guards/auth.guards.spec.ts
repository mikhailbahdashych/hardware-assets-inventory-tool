import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { UserRole } from '@inventory/shared';
import { authGuard, mfaEnrollmentGuard, mustChangePasswordGuard, roleGuard } from './auth.guards';
import { AuthStore } from '../auth/auth.store';

const USER = {
  id: 'u1',
  email: 'a@b.c',
  displayName: 'A',
  role: UserRole.VIEWER,
  isActive: true,
  mustChangePassword: false,
  mfaEnabled: false,
  mfaEnforced: false,
};

function runGuard<T>(guard: (...args: never[]) => T): T {
  return TestBed.runInInjectionContext(() => (guard as () => T)());
}

describe('auth guards', () => {
  let store: AuthStore;
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('authGuard restores an unknown session via me() and allows', async () => {
    const decision = runGuard(authGuard) as Promise<boolean | UrlTree>;
    http.expectOne('/api/v1/auth/me').flush(USER);
    await expect(decision).resolves.toBe(true);
  });

  it('authGuard redirects anon users to /login', async () => {
    store.clear();
    const decision = await (runGuard(authGuard) as Promise<boolean | UrlTree>);
    expect(decision instanceof UrlTree ? router.serializeUrl(decision) : decision).toBe('/login');
  });

  it('mustChangePasswordGuard pins flagged users to /change-password', () => {
    store.applyUser({ ...USER, mustChangePassword: true });
    const decision = runGuard(mustChangePasswordGuard) as UrlTree;
    expect(router.serializeUrl(decision)).toBe('/change-password');
  });

  it('mfaEnrollmentGuard pins enforced-unenrolled users to /mfa-setup', () => {
    store.applyUser({ ...USER, mfaEnforced: true, mfaEnabled: false });
    const decision = runGuard(mfaEnrollmentGuard) as UrlTree;
    expect(router.serializeUrl(decision)).toBe('/mfa-setup');
  });

  it('mfaEnrollmentGuard passes enrolled and unenforced users', () => {
    store.applyUser({ ...USER, mfaEnforced: true, mfaEnabled: true });
    expect(runGuard(mfaEnrollmentGuard)).toBe(true);
    store.applyUser({ ...USER, mfaEnforced: false, mfaEnabled: false });
    expect(runGuard(mfaEnrollmentGuard)).toBe(true);
  });

  it('roleGuard blocks a viewer from an admin route', () => {
    store.applyUser(USER);
    const decision = runGuard(roleGuard(UserRole.ADMIN)) as UrlTree;
    expect(router.serializeUrl(decision)).toBe('/dashboard');
  });

  it('roleGuard passes an admin', () => {
    store.applyUser({ ...USER, role: UserRole.ADMIN });
    expect(runGuard(roleGuard(UserRole.ADMIN))).toBe(true);
  });
});
