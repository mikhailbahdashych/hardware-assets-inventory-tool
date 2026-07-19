import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { APP_NAME, isMfaRequired, SessionUser } from '@inventory/shared';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  template: `
    <div class="auth-wrap">
      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>{{ appName }}</mat-card-title>
          <mat-card-subtitle>
            {{ step() === 'password' ? 'Sign in' : 'Two-factor authentication' }}
          </mat-card-subtitle>
        </mat-card-header>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-content>
          @if (step() === 'password') {
            <form [formGroup]="passwordForm" (ngSubmit)="submitPassword()">
              <mat-form-field appearance="outline" class="full">
                <mat-label>Email</mat-label>
                <input matInput type="email" formControlName="email" autocomplete="username" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Password</mat-label>
                <input
                  matInput
                  type="password"
                  formControlName="password"
                  autocomplete="current-password"
                />
              </mat-form-field>
              @if (error()) {
                <p class="error" role="alert">{{ error() }}</p>
              }
              <button
                matButton="filled"
                type="submit"
                class="full"
                [disabled]="passwordForm.invalid || busy()"
              >
                Sign in
              </button>
            </form>
          } @else {
            <form [formGroup]="codeForm" (ngSubmit)="submitCode()">
              <p class="hint">
                Enter the 6-digit code from your authenticator app — or one of your recovery codes.
              </p>
              <mat-form-field appearance="outline" class="full">
                <mat-label>Code</mat-label>
                <input
                  matInput
                  formControlName="code"
                  autocomplete="one-time-code"
                  inputmode="numeric"
                />
              </mat-form-field>
              @if (error()) {
                <p class="error" role="alert">{{ error() }}</p>
              }
              <button
                matButton="filled"
                type="submit"
                class="full"
                [disabled]="codeForm.invalid || busy()"
              >
                Verify
              </button>
              <button matButton type="button" class="full" (click)="backToPassword()">
                Back to sign in
              </button>
            </form>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .auth-wrap {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 16px;
    }
    mat-card {
      width: min(400px, 100%);
    }
    .full {
      width: 100%;
    }
    .error {
      color: var(--mat-sys-error, #b3261e);
      margin: 0 0 12px;
    }
    .hint {
      opacity: 0.75;
      margin: 0 0 12px;
    }
    form {
      display: flex;
      flex-direction: column;
      margin-top: 8px;
      gap: 4px;
    }
  `,
})
export class LoginPage {
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private ticket: string | null = null;

  protected readonly appName = APP_NAME;
  protected readonly step = signal<'password' | 'code'>('password');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly passwordForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected readonly codeForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(32)]],
  });

  protected async submitPassword(): Promise<void> {
    if (this.passwordForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { email, password } = this.passwordForm.getRawValue();
    try {
      const response = await this.store.login(email, password);
      if (isMfaRequired(response)) {
        this.ticket = response.ticket;
        this.step.set('code');
      } else {
        await this.navigateAfterLogin(response);
      }
    } catch (err) {
      this.error.set(this.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async submitCode(): Promise<void> {
    if (this.codeForm.invalid || this.busy() || !this.ticket) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const user = await this.store.loginMfa(this.ticket, this.codeForm.getRawValue().code);
      await this.navigateAfterLogin(user);
    } catch (err) {
      const serverMessage =
        err instanceof HttpErrorResponse
          ? (err.error as { message?: string } | null)?.message
          : undefined;
      if (serverMessage === 'invalid mfa ticket') {
        // The 5-minute window closed — a fresh password step is the only way on.
        this.backToPassword();
        this.error.set('Your sign-in expired — please enter your password again.');
      } else if (err instanceof HttpErrorResponse && err.status === 401) {
        this.error.set('That code was not accepted. Codes expire quickly — try a fresh one.');
        this.codeForm.reset();
      } else {
        this.error.set(this.messageFor(err));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected backToPassword(): void {
    this.ticket = null;
    this.error.set(null);
    this.codeForm.reset();
    this.step.set('password');
  }

  private async navigateAfterLogin(user: SessionUser): Promise<void> {
    await this.router.navigate([user.mustChangePassword ? '/change-password' : '/dashboard']);
  }

  private messageFor(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401) return 'Invalid email or password.';
      if (err.status === 403) return 'This account is deactivated.';
      if (err.status === 429) return 'Too many attempts — wait a minute and try again.';
    }
    return 'Sign-in failed. Please try again.';
  }
}
