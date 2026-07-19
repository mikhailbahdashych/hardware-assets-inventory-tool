import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UserRole } from '@inventory/shared';
import { AuthStore } from './auth.store';

const USER = {
  id: 'u1',
  email: 'a@b.c',
  displayName: 'A',
  role: UserRole.ADMIN,
  isActive: true,
  mustChangePassword: false,
  mfaEnabled: false,
  mfaEnforced: false,
};

describe('AuthStore', () => {
  let store: AuthStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(AuthStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts unknown with no user', () => {
    expect(store.status()).toBe('unknown');
    expect(store.user()).toBeNull();
  });

  it('login stores the user and flips to authed', async () => {
    const done = store.login('a@b.c', 'pw-long-enough');
    http.expectOne('/api/v1/auth/login').flush(USER);
    await done;
    expect(store.status()).toBe('authed');
    expect(store.user()?.email).toBe('a@b.c');
    expect(store.isAdmin()).toBe(true);
    expect(store.isManagerUp()).toBe(true);
  });

  it('init falls back to anon when me() fails', async () => {
    const done = store.init();
    http.expectOne('/api/v1/auth/me').flush('nope', { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(store.status()).toBe('anon');
  });

  it('logout clears state even when the API call fails', async () => {
    store.applyUser(USER);
    const done = store.logout();
    http.expectOne('/api/v1/auth/logout').flush('boom', { status: 500, statusText: 'ISE' });
    await done.catch(() => undefined);
    expect(store.status()).toBe('anon');
    expect(store.user()).toBeNull();
  });

  it('login with an MFA challenge does NOT establish a session', async () => {
    const done = store.login('a@b.c', 'pw-long-enough');
    http.expectOne('/api/v1/auth/login').flush({ mfaRequired: true, ticket: 't-123' });
    const response = await done;
    expect('mfaRequired' in response).toBe(true);
    expect(store.status()).toBe('unknown');
    expect(store.user()).toBeNull();
  });

  it('loginMfa completes the challenge and applies the session', async () => {
    const done = store.loginMfa('t-123', '654321');
    const req = http.expectOne('/api/v1/auth/login/mfa');
    expect(req.request.body).toEqual({ ticket: 't-123', code: '654321' });
    req.flush(USER);
    await done;
    expect(store.status()).toBe('authed');
    expect(store.user()?.email).toBe('a@b.c');
  });

  it('changePassword clears the mustChangePassword flag locally', async () => {
    store.applyUser({ ...USER, mustChangePassword: true });
    const done = store.changePassword('old-password-1', 'new-password-12');
    http
      .expectOne('/api/v1/auth/change-password')
      .flush(null, { status: 204, statusText: 'No Content' });
    await done;
    expect(store.user()?.mustChangePassword).toBe(false);
  });
});
