# Phase 4: Users Admin Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline execution — the main model implements directly). Steps use checkbox syntax.

**Goal:** Admin-managed application users: paginated user list, creation with one-time temp passwords (forced change at first login), edit (role / active / display name / MFA enforcement), temp-password reset, admin MFA reset — with the last-active-admin invariant, session revocation on deactivation, full audit coverage, and the `/admin/users` Material UI. Plus the security-hardening carry-overs from the Phase 3 review ledger.

**Architecture:** `users` module (service + controller, `@Roles(ADMIN)` on the whole controller). MFA-reset logic is extracted into a shared `resetUserMfa(manager, user)` helper used by both the CLI and the new admin endpoint. Temp passwords are generated server-side (16 chars, crockford alphabet), returned exactly once in the create/reset response, never stored in plaintext, and always set `mustChangePassword`.

## Global Constraints

- Branch `feat/phase-4-users-admin` (stacked on `feat/phase-3-mfa` until PR #1 merges; retarget/rebase after). Node PATH export; commit trailer; push only at the phase gate; PR — never merge to main.
- **API contracts (`/api/v1`, all admin-only):**
  - `GET /users?page&pageSize&search` → `Paginated<SessionUser>` (search: ILIKE email/displayName; ordered by createdAt ASC)
  - `POST /users` `{ email, displayName, role }` → 201 `{ user, tempPassword }` — tempPassword shown ONCE; user gets `mustChangePassword: true`; 409 on duplicate email
  - `GET /users/:id` → `{ user }`
  - `PATCH /users/:id` `{ displayName?, role?, isActive?, mfaEnforced? }` → `{ user }`; **last-active-admin invariant**: 409 when demoting/deactivating the final active admin; deactivation revokes all the target's sessions
  - `POST /users/:id/reset-password` → `{ tempPassword }` (once); sets mustChangePassword; revokes all target sessions
  - `POST /users/:id/mfa/reset` → 204; clears secret/flag/codes/step (enforcement flags untouched); revokes all target sessions; audit `mfa_reset` with the ADMIN as actor
  - Admins may not deactivate/demote **themselves** via PATCH (409) — prevents accidental self-lockout and simplifies the invariant.
  - Audits: `create`/`update` (before/after diffs of changed fields only, no hashes) via explicit `AuditService.log`; `password_change` for admin resets (metadata `{ adminReset: true }`).
- Shared: `CreateUserRequest`, `UpdateUserRequest`, `CreateUserResponse { user, tempPassword }`, `ResetPasswordResponse { tempPassword }` in `@inventory/shared`.
- Temp passwords: 16 chars from the recovery-code alphabet (no ambiguous glyphs), `crypto.randomInt`; validated against nothing (they're server-generated).
- **Hardening carry-overs to land here:** (a) `consumeTotp` uses a conditional `users.update({ id, mfaLastUsedStep: prior }, …)` so simultaneous same-code submissions can't both pass; (b) `validateStep` unit test computes step and code from one timestamp; (c) FE self-service **Disable two-factor auth** dialog (code-confirmed) in the user menu.
- FE: `/admin/users` — MatTable (email, name, role chip, status, MFA state, created), toolbar search, create/edit dialogs, temp-password reveal dialog (copy, must-acknowledge), MFA enforce toggle + reset with confirm; nav item enabled. Role guard: `roleGuard(UserRole.ADMIN)` on the route (convention: list ALL permitted roles explicitly).
- TDD: service invariants unit-tested first; e2e per endpoint group; FE specs for table/dialogs/guard.

## Tasks

1. **Backend hardening carry-overs** — conditional-update `consumeTotp` (+ race unit test with the fake repo), single-timestamp `validateStep` test, extract `resetUserMfa` helper (`auth/mfa-reset.ts`: clears secret/enabled/verifiedAt/step, deletes codes, revokes refresh tokens; takes an EntityManager) and rewire `cli.ts` to it. Verify: unit + e2e green.
2. **Users module API.** DTOs; `UsersService` (list/search/paginate, create with temp password + audit, update with self-change guard + last-admin invariant + deactivation revocation + audit diff, resetPassword, resetMfa via shared helper + audit); `UsersController` `@Roles(ADMIN)`; wire module. Unit: invariant matrix (last admin demote/deactivate 409, second admin ok, self-change 409). e2e: full CRUD lifecycle incl. temp-password login → forced change; viewer/manager 403 on every route; duplicate email 409; deactivated user's session dies (refresh 401); admin MFA reset clears enrollment and kills sessions; audit rows for each mutation.
3. **FE users admin.** `users.api.ts`; `/admin/users` page (table + search + paginator), `user-dialog` (create/edit modes), `temp-password-dialog` (reveal once, copy, acknowledge), MFA reset/enforce controls, nav item enabled; `roleGuard(ADMIN)` route; specs (table renders, create flow shows temp password, viewer hidden nav already covered).
4. **FE self-service MFA disable** — user-menu entry (only when `mfaEnabled`), dialog asking for a TOTP/recovery code, calls `DELETE /auth/mfa`, refreshes the store user; spec.
5. **Phase gate.** Live browser walkthrough (create manager w/ temp password in one window, log in + forced change in another, enforce MFA on them, verify lockdown, admin MFA reset); CI parity from clean install; fable security review + fixes; push; PR (base: feat/phase-3-mfa if PR #1 unmerged, else main).

## Risks
- PATCH audit diffs must never include passwordHash/mfaSecret — build the diff from the DTO fields only.
- Role changes propagate via claims at next refresh (≤15 min) — accepted tradeoff, already ledgered for ARCHITECTURE.md; deactivation is immediate (revocation) and `me` re-checks.
- Stacked-branch PR mechanics: if PR #1 merges mid-phase, rebase onto main before the gate.
- Search param must be ILIKE-escaped (`%`/`_`) — use parameterized query with escaped pattern.

## Verification (phase)
All suites green from clean install; live two-browser walkthrough of the temp-password + forced-change + MFA-enforce + reset loop; audit rows visible for every admin mutation; drift check in sync (no schema changes expected this phase).
