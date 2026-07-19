import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { UserRole } from '@inventory/shared';
import { MfaDisableDialog } from './mfa-disable-dialog';

const drain = () => new Promise((resolve) => setTimeout(resolve));

describe('MfaDisableDialog', () => {
  let http: HttpTestingController;
  const closeFn: { calls: unknown[] } & ((v?: unknown) => void) = Object.assign(
    (v?: unknown) => {
      closeFn.calls.push(v);
    },
    { calls: [] as unknown[] },
  );

  beforeEach(async () => {
    closeFn.calls = [];
    TestBed.configureTestingModule({
      imports: [MfaDisableDialog],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialogRef, useValue: { close: closeFn } },
      ],
    });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function fillAndSubmit(fixture: ReturnType<typeof TestBed.createComponent>): void {
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('input[formControlName=code]') as HTMLInputElement).value = '123456';
    el.querySelector('input[formControlName=code]')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
  }

  it('sends the code to DELETE /auth/mfa, refreshes the session, and closes', async () => {
    const fixture = TestBed.createComponent(MfaDisableDialog);
    fixture.detectChanges();
    fillAndSubmit(fixture);

    const req = http.expectOne('/api/v1/auth/mfa');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ code: '123456' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await drain();

    http.expectOne('/api/v1/auth/me').flush({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      role: UserRole.VIEWER,
      isActive: true,
      mustChangePassword: false,
      mfaEnabled: false,
      mfaEnforced: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await drain();
    expect(closeFn.calls).toEqual([true]);
  });

  it('shows the enforcement message on 403 and stays open', async () => {
    const fixture = TestBed.createComponent(MfaDisableDialog);
    fixture.detectChanges();
    fillAndSubmit(fixture);

    http
      .expectOne('/api/v1/auth/mfa')
      .flush({ message: 'mfa is enforced for this account' }, { status: 403, statusText: 'F' });
    await drain();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'enforced on this account',
    );
    expect(closeFn.calls).toEqual([]);
  });
});
