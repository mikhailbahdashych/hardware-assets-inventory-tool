import { describe, expect, it } from 'vitest';
import { employeeCreateInput, employeePatchInput } from './employees.js';

const MINIMAL = { firstName: 'Maya', lastName: 'Lindqvist', email: 'Maya.Lindqvist@Acme.io' };

describe('employeeCreateInput', () => {
  it('accepts the required trio and lowercases the email', () => {
    const parsed = employeeCreateInput.parse(MINIMAL);
    expect(parsed.email).toBe('maya.lindqvist@acme.io');
    expect(parsed.jobTitle).toBeNull();
  });

  it('requires both names and a valid email', () => {
    expect(employeeCreateInput.safeParse({ ...MINIMAL, firstName: ' ' }).success).toBe(false);
    expect(employeeCreateInput.safeParse({ ...MINIMAL, lastName: '' }).success).toBe(false);
    expect(employeeCreateInput.safeParse({ ...MINIMAL, email: 'maya' }).success).toBe(false);
  });

  it('blanks optional details to null', () => {
    const parsed = employeeCreateInput.parse({ ...MINIMAL, department: '', employeeCode: '  ' });
    expect(parsed.department).toBeNull();
    expect(parsed.employeeCode).toBeNull();
  });

  it('validates the start date as date-only', () => {
    expect(employeeCreateInput.safeParse({ ...MINIMAL, startDate: '2023-01-09' }).success).toBe(
      true,
    );
    expect(employeeCreateInput.safeParse({ ...MINIMAL, startDate: 'Jan 2023' }).success).toBe(
      false,
    );
  });

  it('does not let a create set the status — new people are active', () => {
    const parsed = employeeCreateInput.parse({ ...MINIMAL, status: 'offboarding' } as Record<
      string,
      unknown
    >);
    expect('status' in parsed).toBe(false);
  });
});

describe('employeePatchInput', () => {
  it('accepts a status flip and the optional return-due date it schedules', () => {
    const parsed = employeePatchInput.parse({
      status: 'offboarding',
      returnDueDate: '2026-08-23',
    });
    expect(parsed.status).toBe('offboarding');
    expect(parsed.returnDueDate).toBe('2026-08-23');
  });

  it('rejects unknown statuses', () => {
    expect(employeePatchInput.safeParse({ status: 'vacation' }).success).toBe(false);
  });

  it('accepts an empty patch', () => {
    expect(employeePatchInput.safeParse({}).success).toBe(true);
  });
});
