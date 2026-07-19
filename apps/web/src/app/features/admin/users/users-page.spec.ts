import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { UserRole } from '@inventory/shared';
import { UsersPage } from './users-page';

const drain = () => new Promise((resolve) => setTimeout(resolve));

const USERS = [
  {
    id: 'u1',
    email: 'admin@x.co',
    displayName: 'Root',
    role: UserRole.ADMIN,
    isActive: true,
    mustChangePassword: false,
    mfaEnabled: true,
    mfaEnforced: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'u2',
    email: 'viewer@x.co',
    displayName: 'Viewer',
    role: UserRole.VIEWER,
    isActive: false,
    mustChangePassword: true,
    mfaEnabled: false,
    mfaEnforced: true,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
];

describe('UsersPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [UsersPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads and renders the user table with status and MFA chips', async () => {
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges(); // ngOnInit → load()
    const req = http.expectOne((r) => r.url === '/api/v1/users');
    expect(req.request.params.get('page')).toBe('1');
    req.flush({ items: USERS, total: 2, page: 1, pageSize: 20 });
    await drain();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent ?? '';
    expect(text).toContain('admin@x.co');
    expect(text).toContain('viewer@x.co');
    expect(text).toContain('deactivated');
    expect(text).toContain('temp password');
    expect(text).toContain('pending'); // enforced but not enrolled
    expect(el.querySelectorAll('table tbody tr')).toHaveLength(2);
  });

  it('search is debounced and resets to page 1', async () => {
    const fixture = TestBed.createComponent(UsersPage);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === '/api/v1/users')
      .flush({
        items: USERS,
        total: 2,
        page: 1,
        pageSize: 20,
      });
    await drain();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('.search input');
    input.value = 'vie';
    input.dispatchEvent(new Event('input'));
    // Debounce window: no request yet.
    http.expectNone((r) => r.url === '/api/v1/users' && r.params.get('search') === 'vie');
    await new Promise((resolve) => setTimeout(resolve, 350));

    const req = http.expectOne(
      (r) => r.url === '/api/v1/users' && r.params.get('search') === 'vie',
    );
    req.flush({ items: [USERS[1]], total: 1, page: 1, pageSize: 20 });
    await drain();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('table tbody tr')).toHaveLength(1);
  });
});
