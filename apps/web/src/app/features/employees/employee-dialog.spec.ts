import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { EmployeeDto } from '@inventory/shared';
import { EmployeeDialog, EmployeeDialogResult } from './employee-dialog';

const ADA: EmployeeDto = {
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
};

describe('EmployeeDialog', () => {
  const closeFn: { calls: unknown[] } & ((v?: unknown) => void) = Object.assign(
    (v?: unknown) => {
      closeFn.calls.push(v);
    },
    { calls: [] as unknown[] },
  );

  function setup(data: { mode: 'create' | 'edit'; employee?: EmployeeDto }) {
    closeFn.calls = [];
    TestBed.configureTestingModule({
      imports: [EmployeeDialog],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: closeFn } },
      ],
    });
    const fixture = TestBed.createComponent(EmployeeDialog);
    fixture.detectChanges();
    return fixture;
  }

  function setField(fixture: ReturnType<typeof setup>, name: string, value: string): void {
    const input = fixture.nativeElement.querySelector(
      `[formControlName=${name}]`,
    ) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function submit(fixture: ReturnType<typeof setup>): void {
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form')!.dispatchEvent(new Event('submit'));
  }

  it('create mode: emits trimmed values and null for empty optional fields', () => {
    const fixture = setup({ mode: 'create' });
    setField(fixture, 'firstName', '  Grace ');
    setField(fixture, 'lastName', 'Hopper');
    submit(fixture);

    expect(closeFn.calls).toHaveLength(1);
    const result = closeFn.calls[0] as EmployeeDialogResult;
    expect(result.firstName).toBe('Grace');
    expect(result.lastName).toBe('Hopper');
    expect(result.email).toBeNull();
    expect(result.employeeNumber).toBeNull();
    expect(result.department).toBeNull();
    expect(result.isActive).toBeUndefined(); // create payload carries no isActive
  });

  it('edit mode: prefills from the employee and emits null for a cleared field', () => {
    const fixture = setup({ mode: 'edit', employee: ADA });
    const dept = fixture.nativeElement.querySelector(
      '[formControlName=department]',
    ) as HTMLInputElement;
    expect(dept.value).toBe('Engineering');

    setField(fixture, 'department', ''); // user clears the field
    setField(fixture, 'title', 'Principal Engineer');
    submit(fixture);

    const result = closeFn.calls[0] as EmployeeDialogResult;
    expect(result.department).toBeNull();
    expect(result.title).toBe('Principal Engineer');
    expect(result.email).toBe('ada@corp.co'); // untouched fields keep their values
    expect(result.isActive).toBe(true);
  });

  it('does not close while required fields are missing', () => {
    const fixture = setup({ mode: 'create' });
    setField(fixture, 'firstName', 'OnlyFirst');
    submit(fixture);
    expect(closeFn.calls).toHaveLength(0);
  });
});
