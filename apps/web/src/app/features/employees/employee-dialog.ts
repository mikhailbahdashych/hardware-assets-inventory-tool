import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { EmployeeDto } from '@inventory/shared';

export interface EmployeeDialogData {
  mode: 'create' | 'edit';
  employee?: EmployeeDto;
}

/** Emitted values: optional fields cleared in the form become null (PATCH clears them). */
export interface EmployeeDialogResult {
  firstName: string;
  lastName: string;
  email: string | null;
  employeeNumber: string | null;
  department: string | null;
  title: string | null;
  notes: string | null;
  isActive?: boolean;
}

@Component({
  selector: 'app-employee-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.mode === 'create' ? 'Add employee' : 'Edit employee' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" id="employee-form" (ngSubmit)="save()">
        <div class="row2">
          <mat-form-field appearance="outline">
            <mat-label>First name</mat-label>
            <input matInput formControlName="firstName" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Last name</mat-label>
            <input matInput formControlName="lastName" />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" />
        </mat-form-field>
        <div class="row2">
          <mat-form-field appearance="outline">
            <mat-label>Employee number</mat-label>
            <input matInput formControlName="employeeNumber" />
            <mat-hint>HR / badge id — used to match CSV imports</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Department</mat-label>
            <input matInput formControlName="department" />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Job title</mat-label>
          <input matInput formControlName="title" />
        </mat-form-field>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Notes</mat-label>
          <textarea matInput formControlName="notes" rows="2"></textarea>
        </mat-form-field>
        @if (data.mode === 'edit') {
          <mat-slide-toggle formControlName="isActive">Active</mat-slide-toggle>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close type="button">Cancel</button>
      <button matButton="filled" type="submit" form="employee-form" [disabled]="form.invalid">
        {{ data.mode === 'create' ? 'Create' : 'Save' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .full {
      width: 100%;
    }
    .row2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    mat-slide-toggle {
      display: block;
      margin: 4px 0 8px;
    }
    mat-dialog-content {
      min-width: min(520px, 85vw);
    }
  `,
})
export class EmployeeDialog {
  protected readonly data = inject<EmployeeDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<EmployeeDialog>);
  private readonly fb = inject(FormBuilder);

  protected readonly form = this.fb.nonNullable.group({
    firstName: [
      this.data.employee?.firstName ?? '',
      [Validators.required, Validators.maxLength(100)],
    ],
    lastName: [
      this.data.employee?.lastName ?? '',
      [Validators.required, Validators.maxLength(100)],
    ],
    email: [this.data.employee?.email ?? '', [Validators.email, Validators.maxLength(255)]],
    employeeNumber: [this.data.employee?.employeeNumber ?? '', [Validators.maxLength(64)]],
    department: [this.data.employee?.department ?? '', [Validators.maxLength(120)]],
    title: [this.data.employee?.title ?? '', [Validators.maxLength(120)]],
    notes: [this.data.employee?.notes ?? '', [Validators.maxLength(2000)]],
    isActive: [this.data.employee?.isActive ?? true],
  });

  protected save(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
    const result: EmployeeDialogResult = {
      firstName: raw.firstName.trim(),
      lastName: raw.lastName.trim(),
      email: orNull(raw.email),
      employeeNumber: orNull(raw.employeeNumber),
      department: orNull(raw.department),
      title: orNull(raw.title),
      notes: orNull(raw.notes),
    };
    if (this.data.mode === 'edit') result.isActive = raw.isActive;
    this.ref.close(result);
  }
}
