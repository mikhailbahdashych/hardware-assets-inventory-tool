import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SessionUser, UserRole } from '@inventory/shared';
import { AuthStore } from '../../core/auth/auth.store';
import { EmployeesPage } from './employees-page';

const drain = () => new Promise((resolve) => setTimeout(resolve));

const EMPLOYEES = [
  {
    id: 'e1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@corp.co',
    employeeNumber: 'HR-0001',
    department: 'Engineering',
    title: 'Staff Engineer',
    notes: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'e2',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: null,
    employeeNumber: null,
    department: null,
    title: null,
    notes: null,
    isActive: false,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
];

function sessionUser(role: UserRole): SessionUser {
  return {
    id: 'me',
    email: 'me@x.co',
    displayName: 'Me',
    role,
    isActive: true,
    mustChangePassword: false,
    mfaEnabled: false,
    mfaEnforced: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('EmployeesPage', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [EmployeesPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function renderAs(role: UserRole) {
    TestBed.inject(AuthStore).applyUser(sessionUser(role));
    const fixture = TestBed.createComponent(EmployeesPage);
    fixture.detectChanges(); // ngOnInit → load()
    http
      .expectOne((r) => r.url === '/api/v1/employees')
      .flush({ items: EMPLOYEES, total: 2, page: 1, pageSize: 20 });
    await drain();
    fixture.detectChanges();
    return fixture;
  }

  it('renders the table with name, details, and status chips', async () => {
    const fixture = await renderAs(UserRole.MANAGER);
    const el: HTMLElement = fixture.nativeElement;
    const text = el.textContent ?? '';
    expect(text).toContain('Lovelace, Ada');
    expect(text).toContain('HR-0001');
    expect(text).toContain('Engineering');
    expect(text).toContain('inactive');
    expect(el.querySelectorAll('table tbody tr')).toHaveLength(2);
  });

  it('viewer sees no add button and no actions column', async () => {
    const fixture = await renderAs(UserRole.VIEWER);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain('Add employee');
    expect(el.querySelector('[aria-label="Employee actions"]')).toBeNull();
  });

  it('manager sees add button and row actions; delete stays admin-only', async () => {
    const fixture = await renderAs(UserRole.MANAGER);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Add employee');
    const trigger = el.querySelector('[aria-label="Employee actions"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    trigger.click();
    fixture.detectChanges();
    const menuText = document.body.textContent ?? '';
    expect(menuText).toContain('Edit');
    expect(menuText).not.toContain('Delete');
  });

  it('active-only toggle reloads with isActive=true and resets to page 1', async () => {
    const fixture = await renderAs(UserRole.VIEWER);
    const toggle = fixture.nativeElement.querySelector(
      'mat-slide-toggle button',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    const req = http.expectOne(
      (r) => r.url === '/api/v1/employees' && r.params.get('isActive') === 'true',
    );
    expect(req.request.params.get('page')).toBe('1');
    req.flush({ items: [EMPLOYEES[0]], total: 1, page: 1, pageSize: 20 });
    await drain();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('table tbody tr')).toHaveLength(1);
  });
});
