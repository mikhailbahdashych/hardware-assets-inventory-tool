import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { UserRole } from '@inventory/shared';
import { authInterceptor } from './auth.interceptor';
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

const drain = () => new Promise((resolve) => setTimeout(resolve));

/**
 * Captures resolution/rejection with a handler attached IMMEDIATELY — a
 * rejected promise must never sit handler-less across a macrotask boundary
 * (vitest fails the run on unhandled rejections; CI caught exactly that).
 */
function settle<T>(promise: Promise<T>): Promise<{ ok: boolean; value: unknown }> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (value: unknown) => ({ ok: false, value }),
  );
}

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // Real destinations for the interceptor's fire-and-forget navigations.
        provideRouter([
          { path: 'login', children: [] },
          { path: 'mfa-setup', children: [] },
        ]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('passes non-401 errors through untouched', async () => {
    const res = settle(firstValueFrom(http.get('/api/v1/things')));
    ctrl.expectOne('/api/v1/things').flush('x', { status: 500, statusText: 'ISE' });
    const outcome = await res;
    expect(outcome.ok).toBe(false);
    expect(outcome.value).toMatchObject({ status: 500 });
  });

  it('two parallel 401s trigger exactly one refresh, then both retry', async () => {
    const a = settle(firstValueFrom(http.get('/api/v1/aaa')));
    const b = settle(firstValueFrom(http.get('/api/v1/bbb')));
    ctrl.expectOne('/api/v1/aaa').flush('x', { status: 401, statusText: 'Unauthorized' });
    ctrl.expectOne('/api/v1/bbb').flush('x', { status: 401, statusText: 'Unauthorized' });

    await drain();
    ctrl.expectOne('/api/v1/auth/refresh').flush(USER);
    await drain();

    ctrl.expectOne('/api/v1/aaa').flush({ ok: 'a' });
    ctrl.expectOne('/api/v1/bbb').flush({ ok: 'b' });
    expect(await a).toEqual({ ok: true, value: { ok: 'a' } });
    expect(await b).toEqual({ ok: true, value: { ok: 'b' } });
    expect(TestBed.inject(AuthStore).status()).toBe('authed');
  });

  it('failed refresh clears the session and propagates the original 401', async () => {
    const res = settle(firstValueFrom(http.get('/api/v1/ccc')));
    ctrl.expectOne('/api/v1/ccc').flush('x', { status: 401, statusText: 'Unauthorized' });
    await drain();
    ctrl.expectOne('/api/v1/auth/refresh').flush('x', { status: 401, statusText: 'Unauthorized' });
    await drain();
    const outcome = await res;
    expect(outcome.ok).toBe(false);
    expect(outcome.value).toMatchObject({ status: 401 });
    expect(TestBed.inject(AuthStore).status()).toBe('anon');
  });

  it('never refresh-retries the login endpoint', async () => {
    const res = settle(firstValueFrom(http.post('/api/v1/auth/login', {})));
    ctrl.expectOne('/api/v1/auth/login').flush('x', { status: 401, statusText: 'Unauthorized' });
    const outcome = await res;
    expect(outcome.ok).toBe(false);
    expect(outcome.value).toMatchObject({ status: 401 });
    ctrl.expectNone('/api/v1/auth/refresh');
  });
});
