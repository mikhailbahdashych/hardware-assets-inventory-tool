import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
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

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  afterEach(() => ctrl.verify());

  it('passes non-401 errors through untouched', async () => {
    const res = http.get('/api/v1/things').toPromise();
    ctrl.expectOne('/api/v1/things').flush('x', { status: 500, statusText: 'ISE' });
    await expect(res).rejects.toMatchObject({ status: 500 });
  });

  it('two parallel 401s trigger exactly one refresh, then both retry', async () => {
    const a = http.get('/api/v1/aaa').toPromise();
    const b = http.get('/api/v1/bbb').toPromise();
    ctrl.expectOne('/api/v1/aaa').flush('x', { status: 401, statusText: 'Unauthorized' });
    ctrl.expectOne('/api/v1/bbb').flush('x', { status: 401, statusText: 'Unauthorized' });

    await drain();
    ctrl.expectOne('/api/v1/auth/refresh').flush(USER);
    await drain();

    ctrl.expectOne('/api/v1/aaa').flush({ ok: 'a' });
    ctrl.expectOne('/api/v1/bbb').flush({ ok: 'b' });
    await expect(a).resolves.toEqual({ ok: 'a' });
    await expect(b).resolves.toEqual({ ok: 'b' });
    expect(TestBed.inject(AuthStore).status()).toBe('authed');
  });

  it('failed refresh clears the session and propagates the original 401', async () => {
    const res = http.get('/api/v1/ccc').toPromise();
    ctrl.expectOne('/api/v1/ccc').flush('x', { status: 401, statusText: 'Unauthorized' });
    await drain();
    ctrl.expectOne('/api/v1/auth/refresh').flush('x', { status: 401, statusText: 'Unauthorized' });
    await drain();
    await expect(res).rejects.toMatchObject({ status: 401 });
    expect(TestBed.inject(AuthStore).status()).toBe('anon');
  });

  it('never refresh-retries the login endpoint', async () => {
    const res = http.post('/api/v1/auth/login', {}).toPromise();
    ctrl.expectOne('/api/v1/auth/login').flush('x', { status: 401, statusText: 'Unauthorized' });
    await expect(res).rejects.toMatchObject({ status: 401 });
    ctrl.expectNone('/api/v1/auth/refresh');
  });
});
