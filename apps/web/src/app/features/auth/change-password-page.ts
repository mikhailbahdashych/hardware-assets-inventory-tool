import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-change-password-page',
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
          <mat-card-title>Change password</mat-card-title>
          @if (forced()) {
            <mat-card-subtitle>
              An administrator requires you to set a new password before continuing.
            </mat-card-subtitle>
          }
        </mat-card-header>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline" class="full">
              <mat-label>Current password</mat-label>
              <input
                matInput
                type="password"
                formControlName="currentPassword"
                autocomplete="current-password"
              />
            </mat-form-field>
            <mat-form-field appearance="outline" class="full">
              <mat-label>New password</mat-label>
              <input
                matInput
                type="password"
                formControlName="newPassword"
                autocomplete="new-password"
              />
              <mat-hint>At least 12 characters</mat-hint>
            </mat-form-field>
            @if (error()) {
              <p class="error" role="alert">{{ error() }}</p>
            }
            <div class="actions">
              @if (!forced()) {
                <button matButton type="button" (click)="back()">Cancel</button>
              }
              <button matButton="filled" type="submit" [disabled]="form.invalid || busy()">
                Change password
              </button>
            </div>
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
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class ChangePasswordPage {
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly forced = computed(() => this.store.user()?.mustChangePassword === true);

  protected readonly form = this.fb.nonNullable.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { currentPassword, newPassword } = this.form.getRawValue();
    try {
      await this.store.changePassword(currentPassword, newPassword);
      await this.router.navigate(['/dashboard']);
    } catch (err) {
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 400
          ? 'The current password is incorrect.'
          : 'Password change failed. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected back(): void {
    void this.router.navigate(['/dashboard']);
  }
}
