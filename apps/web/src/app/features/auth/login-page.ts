import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { APP_NAME } from '@inventory/shared';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
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
          <mat-card-subtitle>Sign in</mat-card-subtitle>
        </mat-card-header>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
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
              [disabled]="form.invalid || busy()"
            >
              Sign in
            </button>
          </form>
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
    form {
      display: flex;
      flex-direction: column;
      margin-top: 8px;
    }
  `,
})
export class LoginPage {
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly appName = APP_NAME;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    try {
      const user = await this.store.login(email, password);
      await this.router.navigate([user.mustChangePassword ? '/change-password' : '/dashboard']);
    } catch (err) {
      this.error.set(this.messageFor(err));
    } finally {
      this.busy.set(false);
    }
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
