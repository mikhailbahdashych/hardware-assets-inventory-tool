import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { MfaSetupPage } from './mfa-setup-page';
import { QrService } from '../../core/qr.service';

const OTPAUTH_URI =
  'otpauth://totp/Software%20Inventory:user%40x.co?issuer=Software%20Inventory&secret=JBSWY3DPEHPK3PXP';

const drain = () => new Promise((resolve) => setTimeout(resolve));

describe('MfaSetupPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [MfaSetupPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: QrService,
          useValue: { toDataUrl: () => Promise.resolve('data:image/png;base64,QR') },
        },
      ],
    });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('renders the QR code and manual key after setup starts', async () => {
    const fixture = TestBed.createComponent(MfaSetupPage);
    fixture.detectChanges(); // ngOnInit → begin()
    http.expectOne('/api/v1/auth/mfa/setup').flush({ otpauthUri: OTPAUTH_URI });
    await drain();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('img.qr')?.getAttribute('src')).toBe('data:image/png;base64,QR');
    expect(el.textContent).toContain('JBSWY3DPEHPK3PXP');
  });

  it('verify shows the recovery codes exactly once and gates continue on acknowledgement', async () => {
    const fixture = TestBed.createComponent(MfaSetupPage);
    fixture.detectChanges();
    http.expectOne('/api/v1/auth/mfa/setup').flush({ otpauthUri: OTPAUTH_URI });
    await drain();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('input[formControlName=code]') as HTMLInputElement).value = '123456';
    el.querySelector('input[formControlName=code]')!.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));

    http
      .expectOne('/api/v1/auth/mfa/verify')
      .flush({ recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'] });
    await drain();
    // store.init() refreshes the session user
    http.expectOne('/api/v1/auth/me').flush({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'A',
      role: 'viewer',
      isActive: true,
      mustChangePassword: false,
      mfaEnabled: true,
      mfaEnforced: false,
    });
    await drain();
    fixture.detectChanges();

    expect(el.textContent).toContain('aaaaa-bbbbb');
    const continueBtn = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Continue'),
    ) as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(true);
  });
});
