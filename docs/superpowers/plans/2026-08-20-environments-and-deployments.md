# Environments and Deployments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three-environment story — files policy + prunes, the
deployment guide, one async codebase over two engines (SQLite via libsql,
PostgreSQL), an S3 attachments driver, applied-and-destroyed Terraform, and
the README rewrite — as seven stacked PRs.

**Architecture:** Phases 1–2 are engine-agnostic app/docs work. Phase 3 is
the pivot: better-sqlite3 → libsql makes every service async with zero
behavior change, pinned by the existing suite. Phase 4 adds the Postgres
engine behind one documented type boundary and a CI matrix. Phase 5 adds a
storage seam (local | S3). Phase 6 is Terraform, really applied on the
owner's AWS and really destroyed. Phase 7 rewrites the README last.

**Tech Stack:** Existing stack plus: `@libsql/client` (replaces
`better-sqlite3`), `pg` + drizzle's node-postgres driver, `@aws-sdk/client-s3`,
Terraform (AWS provider). No other additions.

**Spec:** `docs/superpowers/specs/2026-08-20-environments-and-deployments-design.md`
— read it first; decisions there are settled, including the deliberate cuts.

## Global Constraints

- TDD for all app behavior: failing test first, watch it fail, implement,
  watch it pass. Terraform/config files exempt — their proof is
  fmt/validate/plan and the applied validation.
- Full gate per phase: `npm run lint && npm run format:check && npm run
typecheck && npm test && npm run build && npm run e2e`. Phases that touch
  the image add the docker proof; Phase 4 onward adds the pg test leg;
  Phase 6 adds `terraform fmt -check && terraform validate`.
- Repo conventions bind (CLAUDE.mds): named types in `types/` folders, `??`
  only as a documented rule, audit events in the same transaction, error
  envelope via `AppError`, prettier over everything including generated
  drizzle meta.
- Branch discipline: each phase's branch is based on the previous phase's
  tip (order in the spec). **Commit per task and PUSH your branch when your
  phase is green** (`git push -u origin <branch>`). Never push main, never
  merge, never open PRs (the orchestrator does).
- Commit voice from `git log --oneline -30`;
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` last line.
- Do not delete `docs/superpowers/` — the final phase's orchestrator pass does.
- Update every CLAUDE.md whose claims your phase changes, in its own voice.

---

## Phase 1 — files policy + retention prunes (`feat/files-policy-and-prunes`, from main)

Prior art: `apps/api/src/modules/attachments.ts` + `services/attachments.ts`
(the streaming upload, the sanitized extension, the best-effort unlink),
`services/jobs.ts` (`runMaintenance`), `packages/shared/src/schemas/settings.ts`
(+ the Settings page draft pattern), `test/jobs.test.ts`.

### Task 1: The allowlist in shared

**Files:** Modify `packages/shared/src/enums.ts` (or a new
`packages/shared/src/attachments.ts` if enums.ts reads better without it —
follow the file's own organization), `packages/shared/src/index.ts`.
Test beside the shared tests.

**Interfaces (produces):**

```ts
export const ATTACHMENT_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'txt',
  'csv',
  'md',
  'log',
  'zip',
  '7z',
  'tar',
  'gz',
] as const;
export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];
export function isAllowedAttachment(ext: string): ext is AttachmentExtension;
// case-insensitive; the Dropzone accept string derives from the same array.
```

- [ ] Failing tests: allowed/refused table (uppercase `PDF` allowed; `svg`,
      `exe`, `html`, empty refused). Implement. Commit.

### Task 2: Enforcement + sha256 + quota in the API

**Files:** Modify `apps/api/src/services/attachments.ts`,
`apps/api/src/modules/attachments.ts`, `apps/api/src/db/schema.ts`
(+ generated migration via `npm run db:generate -w apps/api`),
`packages/shared/src/schemas/settings.ts` (`uploadQuotaMb`, int,
100 ≤ x ≤ 102400, default 2048 — a create-default like the other settings),
the settings service/route (PATCH diff + audit like every field), and the
export service (sha256 in the attachments section).

**Interfaces (produces):**

- Upload path: refused extension → 422 `file_type_not_allowed`
  ("`.exe` files are not accepted. Attachments can be images, PDFs, office
  documents, text or archives."); over-quota → 413 `storage_quota_exceeded`
  ("This workspace has used 2040 MB of its 2048 MB attachment storage —
  this 12 MB file does not fit."). Quota check = `SUM(size_bytes)` +
  incoming vs `uploadQuotaMb`, inside the upload's transaction.
- `attachments.sha256` TEXT nullable (null = uploaded before checksums
  existed — say so in a comment), computed by piping the stream through
  `createHash('sha256')` on the way to disk.
- `GET /settings` payload + Settings page shape gain
  `storageUsedBytes` (admin already owns that page).
- [ ] Failing tests: type refusal envelope; quota refusal names both
      numbers; a fitting upload records sha256 matching a locally computed
      hash of the fixture; usage in the settings payload; export carries
      sha256. Implement (migration checked in). Commit.

### Task 3: The sweeps in maintenance

**Files:** Modify `apps/api/src/services/jobs.ts` (`runMaintenance`),
`apps/api/src/types/jobs.ts` (`MaintenanceResult` gains
`orphanUploadsRemoved: number` and `notificationRowsPruned: number`).
Test in `test/jobs.test.ts` with the injected clock.

- Orphan sweep: `readdir` the uploads dir, subtract the `stored_name` set,
  unlink files whose mtime is older than 24 h (a file younger than that may
  be an upload whose transaction has not landed), count via pino
  (`log.info({removed}, 'orphan uploads removed')` — operations, not the
  activity log).
- notification_log prune: delete rows with `sent_at` older than 12 months.
- [ ] Failing tests: an orphaned file older than a day goes, a young orphan
      stays, a referenced file stays; notification rows at 13 months go, at 11
      stay; MaintenanceResult counts. Implement. Commit.

### Task 4: The web half + gate

**Files:** Modify `apps/web/src/components/ui/Dropzone.tsx` (accept from
the shared list), the Settings page (quota field on the settings draft
like every numeric field; a usage line "1.2 GB of 2 GB used" in the data
card, formatted via `lib/format.ts` — add `formatBytes` there if absent),
`apps/web/src/types/api.ts`. Tests beside the settings/attachments tests.

- [ ] Failing tests: Dropzone advertises the accept list; settings draft
      round-trips `uploadQuotaMb`; the usage line renders from the payload.
      Implement.
- [ ] **Phase 1 gate** (Global Constraints). Update `apps/api/CLAUDE.md`
      (uploads section: policy, quota, sha256, sweeps — rewrite the §7-era
      "no policy" claims) and `apps/web/CLAUDE.md` if its claims changed.
      Commit. **Push the branch.**

---

## Phase 2 — the deployment guide (`feat/deployment-guide`)

Branch from Phase 1's tip. Prior art: `README.md` (quick start +
deployment notes), `docs/backup-restore.md` and `docs/development.md`
(voice), `apps/api/src/config.ts` (`TRUST_PROXY`, `APP_URL`,
`COOKIE_SECURE`), the origin guard (strict since #30 — the guide must say
APP_URL is load-bearing).

### Task 5: `docs/deployment.md`

Sections, in this order: what production light is (one container, SQLite,
your proxy) · DNS (an A record, nothing exotic) · the reverse-proxy
contract (forward to :3000, pass `Host` through, websockets not needed;
`APP_URL` = exactly the public address — the origin guard 403s mutations
from anywhere else and Secure cookies switch on https; `TRUST_PROXY=true`
so rate limits see client IPs, and why it must NOT be set without a proxy)
· complete copy-paste **Caddyfile** and **nginx** server blocks · firewall
(80/443 in, 3000 loopback-only or docker-network-only) · backups (the
cron line for the stopped-copy and the hot `.backup` variants, pointing at
`docs/backup-restore.md`) · upgrades (pull + up -d) · health
(`/api/v1/healthz`, the container healthcheck) · moving up (a paragraph
pointing at `infrastructure/` for the full-scale build, and the honest
line that SQLite→Postgres data migration is CSV/JSON export-import,
pre-1.0).

- [ ] Write it in the repo's documentation voice; link it from README's
      deployment section; `npm run format:check` covers it.
- [ ] **Phase 2 gate** (cheap — docs only, but run it). Commit. **Push.**

---

## Phase 3 — the async port (`feat/async-db-port`)

Branch from Phase 2's tip. **This phase changes no behavior.** The
existing suite (ported to async call sites) is the definition of done.

Prior art to read first: `apps/api/src/db/client.ts`, `db/migrate.ts`,
`src/types/db.ts`, `src/app.ts` + `src/index.ts` (boot + SIGTERM),
`test/helpers.ts` (`buildTestApp`, `:memory:`), one service end-to-end
(`services/members.ts`) to see the transaction idiom, both CLIs
(`db/seed-demo-cli.ts`, `db/mfa-reset-cli.ts`), `Dockerfile`
(`--ignore-scripts` — `@libsql/client` ships prebuilds; the CI image job
is the proof).

### Task 6: Swap the driver, port the seam

**Files:** `package.json` (apps/api: drop `better-sqlite3` + its @types,
add `@libsql/client`), `db/client.ts` (create via
`createClient({ url: 'file:' + path })`, PRAGMAs through `client.execute`;
`:memory:` for tests), `db/migrate.ts` (drizzle-orm/libsql/migrator),
`types/db.ts` (`Db`/`Tx`/`DbOrTx` re-pointed at the libsql drizzle types;
`DbHandle` closes the client), `app.ts`/`index.ts` (async boot, SIGTERM
closes the client), `test/helpers.ts`.

**Interfaces (produces):** every service signature becomes
`async`/`Promise`-returning; the transaction idiom is
`await deps.db.transaction(async (tx) => { … })`. Route handlers await
services (most already `async (request) => …`).

- [ ] Mechanical sweep: services, plugins (`session.ts` permission
      resolution, rbac), modules, jobs, scheduler, both CLIs, demo seed.
      Chase `npm run typecheck -w apps/api` to zero, then run the api suite and
      fix every await the types could not catch (drizzle thenables make a
      missing await silently pass sometimes — grep for `\.transaction\(` and
      confirm every callback is `async` and awaited; grep `\.get\(\)|\.all\(\)|\.run\(\)`
      sqlite-driver leftovers and replace with awaited builder calls).
- [ ] Full api suite green. Commit in reviewable chunks (driver+db layer;
      services; modules+plugins; clis+jobs; tests) — each compiles.

### Task 7: Unique violations become the correctness story

**Files:** `apps/api/src/lib/errors.ts` (or a new `lib/unique.ts` —
whichever reads better beside `AppError`), the three services with
uniqueness pre-checks (assets tag, employees email, members email).

**Interfaces (produces):**

```ts
/** Registry: constraint/index name → the 422 the form expects. */
export function translateUniqueViolation(error: unknown): AppError | null;
// libsql surfaces 'UNIQUE constraint failed: assets.asset_tag' in message;
// Phase 4 adds pg code 23505 + constraint names to the same registry.
```

Wrap the writing transactions: catch, translate, rethrow the same
`invalidFields` the pre-check produces — the pre-check stays for the
common case's friendliness; the constraint is now the truth. Rewrite the
"synchronous so cannot race" comments and the CLAUDE.md claims.

- [ ] Failing test per uniqueness (insert around the pre-check by seeding
      the row inside the same test, assert 422 envelope unchanged). Implement.
      Commit.

### Task 8: Phase 3 gate

- [ ] Full gate + the docker image proof (build, run, healthz, exec uid
      1000 — the libsql prebuilds must survive `--ignore-scripts`).
- [ ] CLAUDE.md updates: `apps/api/CLAUDE.md` (the sync-transaction claims,
      the testing section, the `db.transaction` idiom), root `CLAUDE.md` if it
      names better-sqlite3. Commit. **Push.**

---

## Phase 4 — the Postgres engine (`feat/postgres-engine`)

Branch from Phase 3's tip. Prior art: everything Phase 3 touched, plus
`drizzle.config.ts`, `.github/workflows/ci.yml`.

### Task 9: The twin schema + parity test

**Files:** Create `apps/api/src/db/schema.pg.ts` (pgTable twin of every
table: `text` stays text — ISO timestamps and dates INCLUDED, deliberately;
sqlite's boolean-mode integers become pg `boolean` — same JS-facing type;
integer cents stay integer; same index/unique names wherever pg allows).
Create `apps/api/drizzle.pg.config.ts` + npm script `db:generate:pg`;
generate and check in `src/migrations-pg/`.
Test: a parity test importing BOTH schema modules and asserting, via
drizzle's `getTableConfig`, identical table names, identical column-name
sets per table, and identical unique/index name sets.

- [ ] Failing parity test (schema.pg.ts missing) → write the twin →
      parity green → generate migrations-pg → commit.

### Task 10: Engine selection behind one boundary

**Files:** Modify `apps/api/src/config.ts` (`DATABASE_URL` optional, must
be `postgres://`/`postgresql://` when present; `engine: 'sqlite' |
'postgres'` derived), `db/schema.ts` (see below), `db/client.ts` (pg branch
via drizzle node-postgres + `pg.Pool`), `db/migrate.ts` (pg migrator on
`migrations-pg/`), `types/db.ts`, `test/helpers.ts`.

**The one documented lie:** `db/schema.ts` selects its export set at
module load — `process.env.DATABASE_URL` present → re-export the pg
tables **cast to the sqlite-dialect table types**; absent → the sqlite
tables as today. The cast is type-sound because the parity test pins
identical JS-facing row types, and runtime-sound because the pg objects
are genuinely pgTable + NodePg all the way down; the comment on the cast
says exactly this and names the parity test. `db/client.ts` performs the
matching cast on the database instance. Nothing outside `db/` ever learns
which engine is running.

**Tests on pg:** the api suite runs against Postgres when `DATABASE_URL`
is set at vitest launch. `test/helpers.ts`: under pg, each test file
creates its own database (`CREATE DATABASE test_<random>` via a
maintenance connection to the server in `DATABASE_URL`), migrates it, and
drops it in teardown — vitest runs files in parallel and they must not
share state. Add root script `npm run test:pg` (docs: needs a local
postgres or the CI service). Extend `translateUniqueViolation` with pg
code `23505` + the constraint-name registry.

- [ ] Failing: parity-driven smoke (helpers boot on pg, `/healthz`, one
      full CRUD + audit read) with `DATABASE_URL` pointing at a local
      container you start for the purpose (`docker run -d -e
POSTGRES_PASSWORD=test -p 5433:5432 postgres:17`). Then run the ENTIRE
      api suite under pg and fix what falls out (expected: date/ordering
      assumptions are already text-safe; watch `last_insert`-style
      assumptions, `sql` fragments with sqlite-only functions —
      `count(*)` and lexicographic text compares are fine). Clean up the
      container. Commit.

### Task 11: CI matrix + boot + gate

**Files:** `.github/workflows/ci.yml` — a new job `api-tests-postgres`
(services: `postgres:17`, env `DATABASE_URL=postgres://…@localhost:5432/…`,
runs `npm test -w apps/api`), kept separate from the main `ci` job so the
sqlite path stays the canonical full gate. Boot (`index.ts`): migrator by
engine; seeds and demo run unchanged through the services (verify
`seed:demo` against the local pg container once, by hand).

- [ ] **Phase 4 gate**: full sqlite gate + the pg api suite locally +
      `docker compose config -q`. CLAUDE.mds: `apps/api/CLAUDE.md` gains "Two
      engines, one boundary" (schema selection, the cast, the parity test,
      test:pg, what belongs in migrations vs migrations-pg);
      root `CLAUDE.md`'s conventions line about SQLite gains the
      DATABASE_URL sentence. Commit. **Push.**

---

## Phase 5 — the S3 attachments driver (`feat/s3-attachments`)

Branch from Phase 4's tip. Prior art: `services/attachments.ts` (all
filesystem touches), the orphan sweep from Task 3, `config.ts`.

### Task 12: The storage seam

**Files:** Create `apps/api/src/services/storage.ts` +
`apps/api/src/types/storage.ts`; modify `services/attachments.ts`,
`services/jobs.ts` (sweep via the seam), `config.ts` (`S3_BUCKET`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`), `types/app.ts`
(`deps.storage`), `app.ts`/`index.ts` (construct the driver).

**Interfaces (produces):**

```ts
export interface AttachmentStorage {
  put(storedName: string, data: Buffer, mime: string): Promise<void>;
  stream(storedName: string): Promise<Readable>;
  remove(storedName: string): Promise<void>; // idempotent
  list(): Promise<StoredObject[]>; // {name, lastModified}
}
export function makeStorage(config: Config, s3?: S3Client): AttachmentStorage;
// local driver = today's fs code moved, byte-for-byte behavior;
// s3 driver: PutObject/GetObject/DeleteObject/ListObjectsV2 under an
// `uploads/` key prefix; the client is injectable for tests, built from
// the default credential chain otherwise.
```

Uploads already cap at 10 MB — buffer and `put`. Downloads pipe
`stream()` with the existing forced-download headers. Sweep ages on
`lastModified`.

- [ ] Failing tests: the local driver passes the existing attachment
      suite untouched; an injected stub S3 client sees put/get/delete with
      the right keys and the sweep removes only old unreferenced objects;
      `makeStorage` picks s3 exactly when `S3_BUCKET` is set. Implement.
      Commit.
- [ ] **Phase 5 gate** (attachment e2e runs on the local driver — that is
      the point). `apps/api/CLAUDE.md` uploads section gains the seam +
      "downloads always proxy, presigned URLs are a deliberate cut".
      `.env.example` gains the S3 block, commented. Commit. **Push.**

---

## Phase 6 — `infrastructure/` (`feat/infrastructure`)

Branch from Phase 5's tip. **Check `terraform -version` first; if absent,
`brew install terraform`.** AWS account 8884…3671, region `eu-central-1`,
credentials already configured — verify `aws sts get-caller-identity`
before anything.

### Task 13: The Terraform

**Files (create, flat):** `infrastructure/{providers,variables,vpc,ec2,
rds,s3,iam,dns,outputs}.tf`, `infrastructure/user_data.sh.tpl`,
`infrastructure/terraform.tfvars.example`, `infrastructure/README.md`,
`infrastructure/.gitignore` (state, tfvars, .terraform).

- **vpc.tf**: VPC 10.0.0.0/16, two AZs, one public subnet (EC2) + two
  private (RDS subnet group), IGW, route tables, **no NAT**, S3 gateway
  endpoint.
- **rds.tf**: `postgres` engine 17, `db.t4g.micro`, 20 GB gp3, private,
  `publicly_accessible = false`, backups 7 days, password from
  `random_password` written to an SSM SecureString (`/inventory/db-url`
  holding the full DATABASE_URL), deletion protection **off** (this is a
  self-hosted starter, and the validation must destroy cleanly — README
  says how to turn it on).
- **ec2.tf**: `t3.small`, AL2023, public subnet + EIP (allocated before
  the instance so `user_data` can template `APP_URL=http://<eip>`), SG
  80/443 in + all out; `user_data.sh.tpl`: dnf install docker, login not
  needed for public images, pull `var.app_image`, write
  `/etc/inventory.env` (DATABASE_URL from SSM via instance role,
  S3_BUCKET, S3_REGION, APP_URL, TRUST_PROXY unset), run the container
  `-p 80:3000` with restart=always. IMPORTANT: the app's origin guard is
  strict — APP_URL must be exactly the address a browser uses.
- **s3.tf**: private bucket, SSE-S3, versioning, public access block.
- **iam.tf**: instance role: that bucket (Get/Put/Delete/List) + that SSM
  parameter (Get) and nothing else.
- **dns.tf**: everything `count = var.domain == null ? 0 : 1` — Route53
  record, ACM cert (DNS validation), ALB 443→instance:80, and APP_URL
  flips to `https://<domain>` in user_data. Untested-by-apply is fine;
  say so in the README.
- **outputs**: `app_url`, `instance_id`, `rds_endpoint`, `bucket`.
- [ ] `terraform fmt` clean, `terraform init -backend=false` +
      `terraform validate` green. Commit.

### Task 14: CI + recipe + docs

**Files:** `.github/workflows/ci.yml` — job `terraform` (on the same
triggers; steps: hashicorp/setup-terraform, `fmt -check`, `init
-backend=false`, `validate` inside `infrastructure/`). Create
`docs/recipes/change-infrastructure.md` — the AI-agent checklist the owner
asked for: resize the instance / change RDS class (which variable, what
`terraform plan` should show), add the domain+TLS module (set `domain`,
what gets created, where APP_URL changes), change region (AMI lookup is
data-sourced — say what else moves), restore RDS from a snapshot, rotate
the DB password (taint the random_password + SSM path + instance restart),
and the standing rule that `fmt`/`validate` gate CI. Update `README.md`'s
deployment section with the full-scale pointer (one paragraph — Phase 7
restructures properly).

- [ ] Commit.

### Task 15: Apply, verify, destroy — on the real account

Protocol (capture real outputs for the report; **the teardown is part of
the task, not an afterthought**):

- [ ] `aws ecr create-repository --repository-name inventory-validation`;
      build the repo image locally, tag/push to it; `terraform apply` with
      `app_image` = that ECR URI (tfvars, not committed).
- [ ] Against `http://<eip>`: `/api/v1/healthz`; complete `/setup` (curl or
      a browser run); create an asset; upload a small PDF attachment;
      **verify the object exists in the bucket** (`aws s3 ls`) and **rows in
      RDS** (attachments count ≥ 1 — via `aws rds` you cannot query; instead
      `docker exec` on the instance via SSM Session Manager `aws ssm
start-session`… if session plugin is absent, verify through the app:
      download the attachment back and byte-compare, and read `/api/v1/meta`
      after an instance reboot — DB-in-RDS is proven by data surviving an
      instance **replacement**: `terraform taint aws_instance… && apply`, then
      the workspace still exists though the instance is new).
- [ ] `terraform destroy` to zero. Then the independent sweep, each
      expected empty: `aws ec2 describe-instances` (non-terminated), `aws rds
describe-db-instances`, `aws ec2 describe-addresses`, `aws ec2
describe-volumes --filters status=available`, `aws ec2 describe-nat-gateways`,
      `aws s3 ls` (validation bucket gone — empty it first if versioned),
      `aws ssm get-parameter` (gone), and finally delete the ECR repo
      (`--force`). Report the sweep output verbatim.
- [ ] **Phase 6 gate**: app gate untouched by this phase but run it;
      terraform fmt/validate. Commit anything the apply taught you (real
      fixes, not scars). **Push.**

---

## Phase 7 — the README rewrite (`docs/readme-rewrite`)

Branch from Phase 6's tip. The owner's asks, verbatim: a table of
contents, and the screenshots as a gallery at the end.

### Task 16: Restructure

- [ ] New shape: title + one-paragraph pitch + badges-free · **Table of
      contents** · What it is (feature bullets, tightened) · **Three ways to
      run it**: Demo (clone, seed, dev — and the Claude-Code-customization
      paragraph), Production light (compose quick start → `docs/deployment.md`),
      Full-scale (→ `infrastructure/README.md`; one honest paragraph on
      engine/S3 env selection) · Configuration (env table — now including
      DATABASE_URL and the S3 block) · Security (existing content, updated) ·
      Development (→ docs/development.md) · **Screenshots** (all ten, with
      their captions, at the end) · License.
- [ ] Verify every command in it against the final tree by running them.
      Check every relative link. `format:check`.
- [ ] **Phase 7 gate** (full). Update root `CLAUDE.md`'s repo map if the
      README's role description drifted. Commit. **Push.** Leave
      `docs/superpowers/` for the orchestrator.

## Orchestrator's close-out (not an agent task)

Review each phase between launches; open the seven PRs at the end
(#base-chained, bottom-up mergeable); delete `docs/superpowers/` on the
final branch; PROJECT_STATUS + its backup; the final report.
