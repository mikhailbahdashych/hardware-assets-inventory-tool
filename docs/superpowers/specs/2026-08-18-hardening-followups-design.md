# Three hardening follow-ups: recovery codes, CSP + strict origin, non-root exec

Approved 2026-08-18. Three items from the status doc's follow-up list, shipped
as three stacked PRs (A ← B ← C), one agent each. All decisions below are
user-approved; the questions that produced them are settled — do not reopen.

## A. Recovery codes regenerate, and admins see two-factor state

**The trigger is one state: enrolled with zero recovery codes left.** Codes
are already deleted on use, so no flag column exists or is needed.

- **`POST /api/v1/members/:id/mfa/reset-codes`** — `requireAction('members.manage')`.
  Target must be enrolled (409 `not_enrolled` otherwise; match the existing
  MFA-reset error style). Deletes the member's `mfa_recovery_codes` rows.
  **Does NOT revoke sessions** — unlike the full MFA reset, nothing is
  un-protected: the authenticator still stands, and the comment in the service
  says so. Allowed on your own account, for the same reason the full reset is.
  Audits `member.mfa_codes_reset` with the target's name snapshot (type auth);
  renderer entry added.
- **Fresh codes at the next successful two-factor sign-in.** In the
  `POST /auth/mfa/verify` success path (both TOTP and recovery-code inputs):
  after verification and inside the same transaction, if the member is
  enrolled and now has zero codes, generate the standard ten, store hashes,
  and return the raw codes in the verify response as `recoveryCodes:
string[]` (optional field — absent on every ordinary sign-in). Shown-once
  rule preserved: this response is the only place they ever exist raw.
  Audits `member.mfa_codes_regenerated` (actor = the member; the sentence
  says codes were reissued, never what they are). Note the natural
  consequence, and test it: a member who spends their **last** code signing
  in gets a fresh set in that same response.
- **`MemberSummary` gains `recoveryCodesLeft: number | null`** — null when
  not enrolled (meaningful absence: there is no set to count), the count of
  remaining rows otherwise. One grouped LEFT-JOIN count, not N queries.
  `mfaEnrolled` already ships on the summary; keep it.
- **Members page: a "Two-factor" column**, rendered **only when the viewer
  holds `members.manage`** (the payload is uniform — reads are open by
  philosophy — the gate is the affordance, like every other admin control on
  the page). Enrolled: pill (design-token colors; pick what the kitchen sink
  already has — no new primitives) + muted "N of 10 codes left". Not
  enrolled: the design's em dash.
- **Overflow menu gains "Reset recovery codes"** beside "Reset two-factor",
  only when the member is enrolled; toast confirms with the member's name.
- **Web login flow:** when the verify response carries `recoveryCodes`, show
  them once before entering the app — reuse the enrolment flow's
  recovery-codes presentation (same component or an extracted one; do not
  duplicate the copy). The member confirms they saved them, then lands in
  the app as normal.
- **e2e journey:** enable workspace MFA, enroll a member, admin resets their
  codes, the member's next sign-in shows ten fresh codes and the members
  page count reads 10; also assert the count decrements after a
  recovery-code sign-in.

## B. The two untaken hardening items

**Origin guard, strict.** Remove the `hostOrigins` fallback in
`plugins/origin-guard.ts`: a mutating request with an Origin/Referer whose
origin differs from `APP_URL`'s is 403 `bad_origin`, and the message names
the fix ("…if this request came from the app itself, APP_URL is
misconfigured"). Keep: the dev-mode skip, the no-header pass (non-browser
clients), the unparseable-origin 403. Update the guard's tests: the case
that used to pass via Host now fails, plus the message content.

**Content-Security-Policy, enforced, production-only by construction.**
Served where the SPA is served (`plugins/static-spa.ts`), so dev (Vite's
HTML, its own injected scripts) is untouched and e2e — which runs the
production build — exercises every journey under the policy.

- **The inline theme script's hash is computed at boot from the built
  `index.html`**: the plugin extracts inline `<script>` bodies and hashes
  them (sha256, base64). No hardcoded hash to rot when the script changes.
  If the built HTML someday has no inline script, the policy simply carries
  no hash.
- Directives (verify each against the real built app before enforcing —
  the MFA QR's rendering decides `img-src`, self-hosted fonts decide
  `font-src`): `default-src 'self'; script-src 'self' 'sha256-…'; style-src
'self' 'unsafe-inline'` (React style attributes are load-bearing);
  `img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src
'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.
  Plus `X-Frame-Options: DENY` on the same responses.
- Send the header on the HTML document responses (the SPA fallback and
  `/index.html`); static assets and API JSON don't execute as documents, but
  sending it everywhere is acceptable if simpler — decide by what the plugin
  already shapes.
- Tests: a header-presence + directive test against the built HTML route in
  the API integration suite (build artifact availability decides where it
  lives — e2e asserts it if the integration suite cannot see a built SPA),
  and the full e2e suite green under enforcement is the real proof. A
  violation would break a journey visibly.

## C. docker exec lands as node

- **`USER node` in the final image stage** (after the existing
  `chown node:node /data /app`).
- **Entrypoint keeps two branches.** Root branch (someone ran `--user root`
  deliberately — the escape hatch, and the self-heal): exactly today's
  behavior — mkdir, conditional chown, setpriv drop. Node branch (the new
  default): `mkdir -p "$DATA_DIR"` if possible, then a writability probe;
  on failure, exit 1 with the exact remedies printed — `chown -R 1000:1000
./data` on the host, or run the container once with `--user root` to let
  it fix itself.
- **README quick start gains `mkdir -p data`** before `docker compose up`
  (the directory is then owned by whoever runs compose; the compose daemon
  would create it root-owned). `docs/development.md` likewise if it starts
  the prod compose. The copy-a-folder backup story is untouched.
- **CI image job**: pre-create the volume dir with uid 1000 ownership, and
  add the acceptance assertion this task exists for — `docker exec` into the
  running container reports uid 1000. Keep the restart/read-back flow green.
- Update the Dockerfile's "deliberately no USER" comment — it is the
  inverse now and should say why the entrypoint still has a root branch.

## Delivery contract (all three)

Stacked branches: `feat/mfa-visibility-and-recovery-codes` ←
`feat/csp-and-strict-origin` ← `feat/docker-nonroot`; three PRs, owner
merges bottom-up. TDD throughout; the full gate per phase is `npm run lint
&& npm run format:check && npm run typecheck && npm test && npm run build
&& npm run e2e` (format:check is in CI — a green local gate must include
it). Task C additionally proves the image locally: build, run with a
correctly-owned bind mount, `docker exec … id -u` = 1000, the failure
message on a root-owned mount, and the `--user root` self-heal. CLAUDE.mds
updated where behavior they document changes (api security sections,
Docker notes). This spec and its plan are deleted in the final branch's
last commit; PROJECT_STATUS updated locally, never committed. No README
screenshots: no existing shot shows the Members columns.

## Deliberate cuts

Self-service code regeneration surface (no profile page exists; the
zero-codes rule at sign-in covers the honest need) · CSP report-only phase
or reporting endpoint · `EXTRA_ORIGINS` allowlist · rootless-daemon
documentation beyond the existing entrypoint comment.
