import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { UserRole } from '@inventory/shared';
import { Shell } from './shell';
import { AuthStore } from '../auth/auth.store';

const BASE_USER = {
  id: 'u1',
  email: 'a@b.c',
  displayName: 'Ada',
  isActive: true,
  mustChangePassword: false,
  mfaEnabled: false,
  mfaEnforced: false,
};

describe('Shell', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Shell],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    await TestBed.compileComponents();
  });

  function renderedNavLabels(): string[] {
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('mat-nav-list a'),
    ).map((a) => a.textContent?.trim() ?? '');
  }

  it('hides admin nav entries from a viewer', () => {
    TestBed.inject(AuthStore).applyUser({ ...BASE_USER, role: UserRole.VIEWER });
    const labels = renderedNavLabels().join(' ');
    expect(labels).toContain('Dashboard');
    expect(labels).not.toContain('Users');
    expect(labels).not.toContain('Audit log');
  });

  it('shows admin nav entries to an admin', () => {
    TestBed.inject(AuthStore).applyUser({ ...BASE_USER, role: UserRole.ADMIN });
    const labels = renderedNavLabels().join(' ');
    expect(labels).toContain('Users');
    expect(labels).toContain('Audit log');
  });

  it('shows the user display name in the toolbar', () => {
    TestBed.inject(AuthStore).applyUser({ ...BASE_USER, role: UserRole.VIEWER });
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ada');
  });
});
