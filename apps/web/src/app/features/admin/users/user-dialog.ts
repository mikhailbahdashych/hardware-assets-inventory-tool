import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SessionUser, UserRole } from '@inventory/shared';

export interface UserDialogData {
  mode: 'create' | 'edit';
  user?: SessionUser;
  /** True when the target is the signed-in admin (role/active locked). */
  isSelf?: boolean;
}

export interface UserDialogResult {
  email?: string;
  displayName: string;
  role: UserRole;
  isActive?: boolean;
  mfaEnforced?: boolean;
}

@Component({
  selector: 'app-user-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.mode === 'create' ? 'Add user' : 'Edit user' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="user-form" (ngSubmit)="save()">
        @if (data.mode === 'create') {
          <mat-form-field appearance="outline" class="full">
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" />
          </mat-form-field>
        }
        <mat-form-field appearance="outline" class="full">
          <mat-label>Display name</mat-label>
          <input matInput formControlName="displayName" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Role</mat-label>
          <mat-select formControlName="role">
            <mat-option [value]="UserRole.ADMIN">Admin</mat-option>
            <mat-option [value]="UserRole.MANAGER">Manager</mat-option>
            <mat-option [value]="UserRole.VIEWER">Viewer</mat-option>
          </mat-select>
        </mat-form-field>
        @if (data.mode === 'edit') {
          <mat-slide-toggle formControlName="isActive" class="row">Active</mat-slide-toggle>
          <mat-slide-toggle formControlName="mfaEnforced" class="row">
            Require two-factor authentication
          </mat-slide-toggle>
        }
        @if (data.isSelf) {
          <p class="hint">You cannot change your own role or deactivate yourself.</p>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close type="button">Cancel</button>
      <button matButton="filled" type="submit" form="user-form" [disabled]="form.invalid">
        {{ data.mode === 'create' ? 'Create' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .full {
      width: 100%;
    }
    .row {
      display: block;
      margin: 8px 0;
    }
    .hint {
      opacity: 0.7;
      font-size: 0.85rem;
    }
    mat-dialog-content {
      min-width: min(400px, 80vw);
    }
  `,
})
export class UserDialog {
  protected readonly data = inject<UserDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<UserDialog>);
  private readonly fb = inject(FormBuilder);
  protected readonly UserRole = UserRole;

  protected readonly form = this.fb.nonNullable.group({
    email: [
      { value: this.data.user?.email ?? '', disabled: this.data.mode === 'edit' },
      this.data.mode === 'create' ? [Validators.required, Validators.email] : [],
    ],
    displayName: [
      this.data.user?.displayName ?? '',
      [Validators.required, Validators.maxLength(120)],
    ],
    role: [
      { value: this.data.user?.role ?? UserRole.VIEWER, disabled: this.data.isSelf === true },
      [Validators.required],
    ],
    isActive: [{ value: this.data.user?.isActive ?? true, disabled: this.data.isSelf === true }],
    mfaEnforced: [this.data.user?.mfaEnforced ?? false],
  });

  protected save(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const result: UserDialogResult = {
      displayName: raw.displayName,
      role: raw.role,
    };
    if (this.data.mode === 'create') {
      result.email = raw.email;
    } else {
      result.isActive = raw.isActive;
      result.mfaEnforced = raw.mfaEnforced;
    }
    this.ref.close(result);
  }
}
