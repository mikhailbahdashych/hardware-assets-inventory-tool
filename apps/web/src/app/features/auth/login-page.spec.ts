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
