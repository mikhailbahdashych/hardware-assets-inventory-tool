import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { APP_NAME } from '@inventory/shared';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-setup-page',
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
          <mat-card-title>Welcome to {{ appName }}</mat-card-title>
          <mat-card-subtitle>Create the administrator account for this instance</mat-card-subtitle>
        </mat-card-header>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline" class="full">
              <mat-label>Display name</mat-label>
              <input matInput formControlName="displayName" autocomplete="name" />
            </mat-form-field>
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
                autocomplete="new-password"
              />
              <mat-hint>At least 12 characters</mat-hint>
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
              Create admin account
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
      width: min(440px, 100%);
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
      gap: 4px;
    }
  `,
})
export class SetupPage {
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly appName = APP_NAME;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.store.setup(this.form.getRawValue());
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 403
          ? 'Setup was already completed — sign in instead.'
          : 'Setup failed. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
