import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthApi } from '../../core/auth/auth.api';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-mfa-disable-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>Disable two-factor authentication</h2>
    <mat-dialog-content>
      <p>
        Confirm with a current authenticator code or one of your recovery codes. Your other sessions
        will be signed out.
      </p>
      <form [formGroup]="form" id="mfa-disable-form" (ngSubmit)="confirm()">
        <mat-form-field appearance="outline" class="full">
          <mat-label>Code</mat-label>
          <input matInput formControlName="code" autocomplete="one-time-code" />
        </mat-form-field>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close type="button">Cancel</button>
      <button
        matButton="filled"
        type="submit"
        form="mfa-disable-form"
        [disabled]="form.invalid || busy()"
      >
        Disable MFA
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .full {
      width: 100%;
    }
    .error {
      color: var(--mat-sys-error, #b3261e);
      margin: 0;
    }
    mat-dialog-content {
      max-width: 420px;
    }
  `,
})
export class MfaDisableDialog {
  private readonly api = inject(AuthApi);
  private readonly store = inject(AuthStore);
  private readonly ref = inject(MatDialogRef<MfaDisableDialog>);
  private readonly fb = inject(FormBuilder);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(32)]],
  });

  protected async confirm(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.mfaDisable(this.form.getRawValue().code));
      await this.store.init();
      this.ref.close(true);
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 403) {
        this.error.set('MFA is enforced on this account and cannot be disabled.');
      } else if (err instanceof HttpErrorResponse && err.status === 429) {
        this.error.set('Too many attempts — wait a minute and try again.');
      } else {
        this.error.set('That code was not accepted — try a fresh one.');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
