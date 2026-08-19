# Hardening Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three approved follow-ups — recovery-code reset/replenish with
admin-visible two-factor state, the CSP + strict origin guard, and a
`docker exec` that lands as node — as three stacked PRs.

**Architecture:** Phase A extends the existing MFA machinery (codes are deleted
on use, so "enrolled with zero codes" is the one trigger; no new tables, no
migration). Phase B tightens `plugins/origin-guard.ts` and teaches
`plugins/static-spa.ts` to serve a CSP whose inline-script hash it computes
from the built HTML at boot. Phase C puts `USER node` in the image and turns
the entrypoint's root chown into an escape hatch behind a writability probe.

**Tech Stack:** Existing only. No new dependencies anywhere.

**Spec:** `docs/superpowers/specs/2026-08-18-hardening-followups-design.md` —
read it first; decisions there are settled.

## Global Constraints

- TDD: failing test first, watch it fail, implement, watch it pass — every task with behavior.
- Full gate per phase end: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run e2e`. **format:check is in CI; a green local gate must include it.** Generated files (drizzle meta) stay prettier-formatted — never revert prettier churn as noise.
- Repo conventions bind: named types in `types/` folders; `??` only as a documented rule; every mutation audits in its own transaction; audit params snapshot names/labels; error style `AppError(status, code, message)`.
- Branch discipline: Phase A on `feat/mfa-visibility-and-recovery-codes` (current), Phase B branches from A as `feat/csp-and-strict-origin`, Phase C from B as `feat/docker-nonroot`. Commit per task, repo voice (`git log --oneline -30`), `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do not delete `docs/superpowers/` — the orchestrator does that at the end.

---

## Phase A — recovery codes + two-factor visibility (Agent 1)

Prior art to read first: `apps/api/src/services/mfa.ts` (enrolment, verify,
`resetMemberMfa`, `issueRecoveryCodes` or its equivalent), `apps/api/src/modules/members.ts`
(`/:id/mfa/reset` route + its guard comments), `apps/api/src/modules/auth.ts`
(the `mfa/verify` route), `apps/api/src/lib/serialize.ts`,
`apps/web/src/features/members/MembersPage.tsx`,
`apps/web/src/features/auth/` (login MFA step + `MfaEnrollPage`'s
recovery-codes presentation), `e2e/tests/` (the MFA spec from PR #23).

### Task 1: `recoveryCodesLeft` on the member summary

**Files:**

- Modify: `apps/api/src/lib/serialize.ts`, `apps/api/src/services/members.ts`
  (`listMembers`), `apps/api/src/types/members.ts` (`MemberSummary`)
- Test: the members service/route tests

**Interfaces (produces):** `MemberSummary.recoveryCodesLeft: number | null` —
null when not enrolled (meaningful absence: no set exists to count), else the
count of remaining `mfa_recovery_codes` rows. One grouped query, not N:

```ts
const counts = new Map(
  db
    .select({ memberId: mfaRecoveryCodes.memberId, count: sql<number>`count(*)` })
    .from(mfaRecoveryCodes)
    .groupBy(mfaRecoveryCodes.memberId)
    .all()
    .map((row) => [row.memberId, row.count]),
);
// per member: member.mfaConfirmedAt === null ? null : (counts.get(member.id) ?? 0)
// — the ?? 0 is a genuine zero (an enrolled member whose codes are spent), say so.
```

**Steps:**

- [ ] Failing tests: enrolled member with a full set reports 10; after two
      are consumed reports 8; unenrolled reports null; enrolled-with-zero reports 0.
      Drive through `GET /api/v1/members` with a real enrolment (the MFA test
      helpers exist — reuse them).
- [ ] Run/fail → implement → run/pass → commit.

### Task 2: `POST /api/v1/members/:id/mfa/reset-codes`

**Files:**

- Modify: `apps/api/src/services/mfa.ts` (new `resetMemberRecoveryCodes`),
  `apps/api/src/modules/members.ts` (route beside `/:id/mfa/reset`),
  `packages/shared/src/audit-render.ts` (renderer for `member.mfa_codes_reset`)
- Test: members route tests + audit renderer goldens

**Interfaces (produces):**

```ts
export function resetMemberRecoveryCodes(db: DbOrTx, memberId: string): void;
// 409 not_enrolled ("That member has no authenticator, so there are no codes
// to reset." — match the existing mfa error voice) when mfaConfirmedAt is null.
// Deletes the member's mfa_recovery_codes rows. Deliberately does NOT touch
// sessions: the authenticator still stands, nothing is un-protected — comment
// contrasts this with resetMemberMfa directly above it.
```

Route: `requireAction('members.manage')`, allowed on your own account (same
reasoning comment as the full reset), 204. Audit in the same transaction:
`member.mfa_codes_reset`, type `auth`, params `{ name }` (target's display
name snapshot). Renderer: "Reset NAME's recovery codes".

**Steps:**

- [ ] Failing tests: 403 without `members.manage`; 409 on an unenrolled
      target with the envelope; codes gone after the call while **sessions
      survive** (assert the target's session cookie still works); audit row with
      the name; works on the caller's own account.
- [ ] Run/fail → implement → run/pass → commit.

### Task 3: Fresh codes at the next two-factor sign-in

**Files:**

- Modify: `apps/api/src/services/mfa.ts` (the verify path),
  `apps/api/src/modules/auth.ts` (verify response shape),
  `packages/shared/src/audit-render.ts` (`member.mfa_codes_regenerated`)
- Test: auth/mfa integration tests

**Interfaces (produces):** the verify success result gains
`recoveryCodes?: string[]` — present only when this sign-in triggered a
replenish. Inside the verify transaction, **after** the factor is accepted
(and after a spent recovery code's row is deleted): if the member is enrolled
and now holds zero codes, generate the standard ten through the existing
generator, store hashes, carry the raws out in the response. Audit
`member.mfa_codes_regenerated`, type `auth`, actor = the member,
params `{ name }`; renderer: "NAME's recovery codes were reissued" (the
sentence names the fact, never the codes).

**Steps:**

- [ ] Failing tests: after an admin reset, the next TOTP verify returns
      exactly 10 raw codes and they verify against stored hashes; an ordinary
      verify (codes remaining) returns no `recoveryCodes` key; **spending the
      last recovery code returns a fresh 10 in that same response**; one of the
      fresh codes works for a later sign-in; the audit row exists with the
      member as actor.
- [ ] Run/fail → implement → run/pass → commit.

### Task 4: Members page — the Two-factor column + reset action

**Files:**

- Modify: `apps/web/src/types/api.ts` (`MemberSummary` wire type),
  `apps/web/src/api/mutations.ts` (`useResetRecoveryCodes`),
  `apps/web/src/features/members/MembersPage.tsx` (+ its types/ and CSS module)
- Test: `apps/web/src/features/members/members.test.tsx`

Column "Two-factor", rendered **only when `can(permissions, 'members.manage')`**
(conditional column in the columns array — the payload is uniform, the gate is
the affordance): enrolled → `Pill` (pick the sv the kitchen sink's semantics
suggest — `ok` reads as "protected") plus muted text "N of 10 codes left";
not enrolled → the design's em dash. Overflow menu gains "Reset recovery
codes" beside "Reset two-factor", only when the member is enrolled; success
toast `` `${member.displayName} will get fresh codes at their next sign-in.` ``.
Mutation invalidates through `invalidateAdmin` like its neighbours.

**Steps:**

- [ ] Failing tests: column present for a members.manage viewer and absent
      otherwise; "3 of 10 codes left" renders from the stub; em dash for
      unenrolled; menu item fires `POST /members/:id/mfa/reset-codes` and shows
      the toast.
- [ ] Run/fail → implement → run/pass → commit.

### Task 5: The codes handed over at sign-in

**Files:**

- Modify: the login MFA step in `apps/web/src/features/auth/` (verify
  response handling), extract the recovery-codes presentation from
  `MfaEnrollPage` into a shared component in `features/auth/` if it is not
  already one (+ types)
- Test: auth feature tests via the api-stub

When the verify response carries `recoveryCodes`, do not enter the app yet:
show the codes once — same visual as enrolment (the extracted component), a
line saying why ("Your recovery codes were reset — here is your new set.
They will not be shown again."), and a confirm button that then completes
sign-in as normal. No `recoveryCodes` → today's flow byte-for-byte.

**Steps:**

- [ ] Failing tests: stubbed verify with 10 codes → codes screen renders all
      10 and the app shell is NOT mounted; confirm → lands on the dashboard;
      stubbed verify without codes → straight in, no interstitial.
- [ ] Run/fail → implement → run/pass → commit.

### Task 6: e2e + docs + Phase A gate

**Files:**

- Create/extend: the e2e MFA spec (`e2e/tests/`)
- Modify: `apps/api/CLAUDE.md` (two-factor section), `apps/web/CLAUDE.md`
  (members/auth notes) where their claims change

e2e journey: enable workspace MFA → enroll a member (helpers exist) → as
admin, members page shows "10 of 10 codes left" → sign in once with a
recovery code → count reads 9 → admin resets codes (count 0) → the member's
next sign-in presents ten fresh codes → confirm → count reads 10.

**Steps:**

- [ ] Write the spec, run the FULL `npm run e2e`, fix regressions honestly
      (never weaken an assertion to pass).
- [ ] **Phase A gate** (Global Constraints command) all green. Update the two
      CLAUDE.mds. Commit.

---

## Phase B — CSP + strict origin guard (Agent 2)

Branch: `git checkout -b feat/csp-and-strict-origin` from Phase A's tip.
Prior art: `apps/api/src/plugins/origin-guard.ts` (44 lines — read it all),
`apps/api/src/plugins/static-spa.ts`, their tests, `apps/web/index.html`
(the inline theme script the hash must cover), `e2e/` config (prod build).

### Task 7: Origin guard, strict

**Files:**

- Modify: `apps/api/src/plugins/origin-guard.ts`
- Test: the origin-guard tests

Delete the `hostOrigins` fallback (lines building
`[http://host, https://host]` and the `!hostOrigins.includes(origin)` arm).
The check becomes exactly `origin !== appOrigin` → 403 `bad_origin` with:
"Cross-origin requests are not allowed. If this request came from the app
itself, APP_URL is misconfigured — this instance expects ORIGIN." Keep:
dev-mode skip, safe-method pass, no-header pass, unparseable-origin 403.
Update the plugin's doc comment: the fallback existed to tolerate a wrong
APP_URL, which is exactly when it became the only check — a wrong APP_URL
now fails loudly at the first mutation, and the startup warning names it.

**Steps:**

- [ ] Failing tests: `Origin: https://evil.example` + `Host: evil.example`
      is now 403 (this exact case passed before — flip the old test's
      expectation, do not delete it); matching-origin mutation still 200; the
      403 message names the expected origin.
- [ ] Run/fail → implement → run/pass → commit.

### Task 8: Content-Security-Policy from the built HTML

**Files:**

- Modify: `apps/api/src/plugins/static-spa.ts` (+ `apps/api/src/types/` if a
  named shape appears)
- Test: the static-spa tests (they already fixture a fake dist dir — extend it)

At registration, read `index.html` from the configured web dist, extract
every inline script body, hash each:

```ts
import { createHash } from 'node:crypto';
const bodies = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => m[1]!,
); // the group is non-optional in a matched result
const hashes = bodies.map((b) => `'sha256-${createHash('sha256').update(b).digest('base64')}'`);
```

Build the policy once:
`default-src 'self'; script-src 'self' <hashes>; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
— **verify `img-src data:` and `style-src 'unsafe-inline'` against the real
built app before enforcing** (the MFA QR and React style attributes are the
two consumers; if the QR turns out to be inline SVG, drop `data:` and say so
in the commit). Send `content-security-policy` and `x-frame-options: DENY`
on every response static-spa serves the **HTML document** for (the SPA
fallback and `/index.html`); asset responses may carry it too if the plugin's
shape makes that simpler — decide there, in a comment.

**Steps:**

- [ ] Failing tests: the fixture dist's HTML gets a CSP header whose
      script-src contains the sha256 of the fixture's inline script; a fixture
      with no inline script yields a policy with no hash; `frame-ancestors
'none'` and `x-frame-options` present; API JSON routes unaffected (or
      deliberately affected — match the implementation).
- [ ] Run/fail → implement → run/pass.
- [ ] **Run the full e2e suite** — 45+ journeys under the enforced policy is
      the real proof. A CSP violation shows up as a broken screen; investigate
      any failure as a policy bug, not a test bug. Add one e2e assertion that the
      document response carries the header.
- [ ] **Phase B gate** all green. Update `apps/api/CLAUDE.md`'s security
      bullet (CSRF stance + new CSP paragraph). Commit.

---

## Phase C — docker exec lands as node (Agent 3)

Branch: `git checkout -b feat/docker-nonroot` from Phase B's tip.
Prior art: `Dockerfile` (tail comments explain today's deliberate no-USER),
`docker-entrypoint.sh` (30 lines — read it all), `docker-compose.yml`,
`.github/workflows/ci.yml` (the image job), `README.md` deployment/quick
start, `docs/development.md`, `docs/backup-restore.md`.

### Task 9: Image runs as node; entrypoint probes instead of chowns

**Files:**

- Modify: `Dockerfile` (add `USER node` after the existing
  `RUN mkdir -p /data && chown -R node:node /data /app`; rewrite the
  "deliberately no USER" comment to explain the inverse), `docker-entrypoint.sh`

New entrypoint (whole file — root branch is now the escape hatch):

```sh
#!/bin/sh
set -e

# The image runs as node (USER in the Dockerfile), so `docker exec` lands as
# node too. The cost: nothing in the default path may chown a bind-mounted
# /data that arrives owned by somebody else — so this probes and explains
# instead of failing on the first mkdir with a bare EACCES.
#
# Started explicitly with --user root, the old behavior is the escape hatch:
# take ownership, drop to node, run. One such run heals a mount in place.

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = '0' ]; then
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
    chown -R node:node "$DATA_DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

mkdir -p "$DATA_DIR" 2>/dev/null || true
if ! touch "$DATA_DIR/.writable-probe" 2>/dev/null; then
  echo "The data directory ($DATA_DIR) is not writable by uid $(id -u)." >&2
  echo "On the host, either:  chown -R 1000:1000 ./data" >&2
  echo "or run the container once as root to let it fix itself:" >&2
  echo "  docker compose run --rm --user root inventory node -e ''" >&2
  exit 1
fi
rm -f "$DATA_DIR/.writable-probe"
exec "$@"
```

**Steps:**

- [ ] `docker build` the image locally. Verify all four behaviors:
      (1) run with a bind mount pre-owned by uid 1000 → healthy, and
      `docker exec <c> id -u` prints **1000** — the acceptance test;
      (2) run with a root-owned bind mount → exits 1 printing both remedies;
      (3) `--user root` run against that same mount → chowns, drops, healthy —
      and a normal restart afterwards works;
      (4) restart survives (data intact).
- [ ] Commit.

### Task 10: Docs + CI

**Files:**

- Modify: `README.md` (quick start gains `mkdir -p data` before
  `docker compose up`, one sentence on why; a line that exec sessions are
  uid 1000 now), `docker-compose.yml` (comment above the volume: create
  `./data` yourself so it is yours — the daemon would create it root-owned),
  `docs/development.md` if it starts the prod compose,
  `.github/workflows/ci.yml` (image job: create the volume dir owned by
  1000 before `docker run`; add the assertion step
  `test "$(docker exec inventory id -u)" = "1000"`)

**Steps:**

- [ ] Make the edits; re-run the local docker verification once more after
      any Dockerfile touch.
- [ ] **Phase C gate**: the full Global Constraints command (the app code is
      untouched, but the gate is cheap insurance), plus the docker verification
      protocol above. Commit. Do NOT delete `docs/superpowers/` — the
      orchestrator does that.
