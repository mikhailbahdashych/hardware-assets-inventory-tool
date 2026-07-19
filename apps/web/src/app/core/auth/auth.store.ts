import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  isMfaRequired,
  LoginResponse,
  SessionUser,
  SetupRequest,
  UserRole,
} from '@inventory/shared';
import { AuthApi } from './auth.api';

export type AuthStatus = 'unknown' | 'authed' | 'anon';

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthApi);

  private readonly userSignal = signal<SessionUser | null>(null);
  private readonly statusSignal = signal<AuthStatus>('unknown');

  readonly user = this.userSignal.asReadonly();
  readonly status = this.statusSignal.asReadonly();
  readonly isAdmin = computed(() => this.userSignal()?.role === UserRole.ADMIN);
  readonly isManagerUp = computed(() => {
    const role = this.userSignal()?.role;
    return role === UserRole.ADMIN || role === UserRole.MANAGER;
  });

  /** Session restore on app start: me() succeeds via cookie (or interceptor refresh). */
  async init(): Promise<void> {
    try {
      this.applyUser(await firstValueFrom(this.api.me()));
    } catch {
      this.clear();
    }
  }

  /** Password step. Applies the session only when no second factor is pending. */
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await firstValueFrom(this.api.login({ email, password }));
    if (!isMfaRequired(response)) this.applyUser(response);
    return response;
  }

  /** Second factor: TOTP or recovery code against the login ticket. */
  async loginMfa(ticket: string, code: string): Promise<SessionUser> {
    const user = await firstValueFrom(this.api.loginMfa({ ticket, code }));
    this.applyUser(user);
    return user;
  }

  async setup(body: SetupRequest): Promise<SessionUser> {
    const user = await firstValueFrom(this.api.setup(body));
    this.applyUser(user);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this.clear();
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await firstValueFrom(this.api.changePassword({ currentPassword, newPassword }));
    const current = this.userSignal();
    if (current) this.userSignal.set({ ...current, mustChangePassword: false });
  }

  applyUser(user: SessionUser): void {
    this.userSignal.set(user);
    this.statusSignal.set('authed');
  }

  clear(): void {
    this.userSignal.set(null);
    this.statusSignal.set('anon');
  }
}
