# Phase 5: Employees Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline execution — the main model implements directly). Steps use checkbox syntax.

**Goal:** The employee registry — the people who HOLD assets (distinct from app users): paginated/searchable/filterable CRUD API with the spec's role split (Viewer reads, Manager writes, Admin deletes), guarded hard-delete (409 while assignments reference — "deactivate instead"), full audit coverage, and the `/employees` Material UI with create/edit dialogs. This is the template module for Phases 6-7, deliberately reusing the users-module patterns (escapeLike, audit whitelist diff, dialog flow).

## Global Constraints

- Branch `feat/phase-5-employees` (based on `origin/feat/phase-4-users-admin` until PR #4 merges; retarget to main after). Node PATH export; commit trailer; push only at the phase gate; PR — never merge.
- **API contracts (`/api/v1`):**
  - `GET /employees?page&pageSize&search&isActive` → `Paginated<EmployeeDto>` — any authed role. Search: escaped ILIKE over firstName/lastName/email/employeeNumber; `isActive` optional bool filter; order lastName, firstName, id.
  - `GET /employees/:id` → `EmployeeDto` — any authed role.
  - `POST /employees` — Manager/Admin. `{ firstName, lastName, email?, employeeNumber?, department?, title?, notes? }` → 201; email/employeeNumber lowercased/trimmed; 409 on partial-unique conflicts (PG 23505) with a message naming the colliding field when derivable.
  - `PATCH /employees/:id` — Manager/Admin. Same fields plus `isActive`. Explicit `null` clears an optional field (email/employeeNumber/department/title/notes).
  - `DELETE /employees/:id` — Admin only. 409 when ANY assignment references the employee ("this employee has assignment history — deactivate instead"); hard delete otherwise; the FK RESTRICT is the DB backstop. Audit `delete` with full before-state.
  - Audits: `create` (after), `update` (changed-field whitelist diff incl. explicit clears), `delete` (before) — same shape as users module.
- Shared types: `EmployeeDto { id, firstName, lastName, email, employeeNumber, department, title, notes, isActive, createdAt, updatedAt }` (nullables as `string | null`), `CreateEmployeeRequest`, `UpdateEmployeeRequest` in `@inventory/shared`.
- Role note (deliberate, per Phase-4 review): employees are plain data, not a privilege surface — claims-based `@Roles` is sufficient; NO `assertActiveAdmin`-style DB recheck here.
- FE: `/employees` visible to all roles; write actions (Add/Edit/Delete/Deactivate) hidden for Viewer via `AuthStore.isManagerUp` / `isAdmin`. Dialog-based create/edit (users-page pattern); a separate detail page arrives in Phase 7 with assignment history. Nav item enabled.
- TDD: e2e per endpoint group (role matrix, uniqueness conflicts, delete guard incl. FK-referenced case via a directly-inserted assignment row, clear-field semantics); FE table/dialog/role-visibility specs.

## Tasks

1. **Shared types + backend module.** `EmployeeDto`+requests in shared; `employees/` module: list/create/update/delete service (escapeLike reuse, whitelist audit diff incl. null-clears, delete guard via assignment count then hard delete), DTOs (create: firstName/lastName required 1..100, email IsEmail optional, employeeNumber 1..64 optional, department/title ≤120, notes ≤2000; update: all optional + isActive + explicit-null support via `@ValidateIf`), controller with per-route roles (class stays undecorated so Viewer can read), wire into AppModule. e2e: role matrix (viewer read-only 200s + write 403s; manager writes; admin delete), dup email + dup employeeNumber 409, clear-a-field via null, delete guard 409 with an inserted assignment row, audit rows for each mutation.
2. **FE employees page + dialog.** `employees.api.ts`; `/employees` page (table: name, email, number, department, title, status chip; search + active-only toggle; paginator; role-gated Add/row-actions), `employee-dialog` (create/edit, optional fields clear to null when emptied), nav enable, route (authGuard only — all roles). Specs: table renders + role-gated actions hidden for viewer, dialog emits null for cleared optionals.
3. **Phase gate.** Live browser walkthrough (create/edit/search employees as admin; viewer sees read-only), CI parity from clean install, fable review + fixes, push, PR (base feat/phase-4-users-admin until #4 merges, else main).

## Risks
- Explicit-null clearing vs "field omitted": PATCH must distinguish undefined (untouched) from null (clear) — class-validator needs `@IsOptional()` replaced with `@ValidateIf((o, v) => v !== undefined)` on nullable strings so `null` passes validation. Test both.
- Duplicate-detection message: PG 23505 detail names the constraint — map uq_employees_email / uq_employees_employee_number to friendly messages, fall back to generic.
- Empty-string vs null from FE forms: dialog normalizes '' → null before submit.

## Verification (phase)
All suites green from clean install; browser walkthrough incl. a viewer session proving read-only UI; audit rows visible; drift check in sync (no schema changes).
