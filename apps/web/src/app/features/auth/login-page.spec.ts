import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LoginPage } from './login-page';

describe('LoginPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('disables submit until the form is valid', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button[type=submit]');
    expect(button.disabled).toBe(true);
  });

  it('switches to the code step when the server demands a second factor', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    (el.querySelector('input[formControlName=email]') as HTMLInputElement).value = 'a@b.c';
    el.querySelector('input[formControlName=email]')!.dispatchEvent(new Event('input'));
    (el.querySelector('input[formControlName=password]') as HTMLInputElement).value = 'right-pw';
    el.querySelector('input[formControlName=password]')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/v1/auth/login').flush({ mfaRequired: true, ticket: 't-1' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('Two-factor authentication');
    expect(el.querySelector('input[formControlName=code]')).toBeTruthy();

    (el.querySelector('input[formControlName=code]') as HTMLInputElement).value = '123456';
    el.querySelector('input[formControlName=code]')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const mfaReq = http.expectOne('/api/v1/auth/login/mfa');
    expect(mfaReq.request.body).toEqual({ ticket: 't-1', code: '123456' });
    mfaReq.flush({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      role: 'viewer',
      isActive: true,
      mustChangePassword: false,
      mfaEnabled: true,
      mfaEnforced: false,
    });
    await fixture.whenStable();
  });

  it('shows an error message on 401', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    (el.querySelector('input[formControlName=email]') as HTMLInputElement).value = 'a@b.c';
    el.querySelector('input[formControlName=email]')!.dispatchEvent(new Event('input'));
    (el.querySelector('input[formControlName=password]') as HTMLInputElement).value = 'wrong-pw';
    el.querySelector('input[formControlName=password]')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    http.expectOne('/api/v1/auth/login').flush('x', { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.error')?.textContent).toContain('Invalid email or password');
  });
});
