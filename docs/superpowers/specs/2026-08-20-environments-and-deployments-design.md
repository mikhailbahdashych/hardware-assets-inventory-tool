# Environments and deployments

Approved 2026-08-20. Three environments — demo (done), production light
(compose + a documented reverse proxy), full-scale (Terraform: EC2 + RDS
PostgreSQL + S3) — plus the files policy and the notification_log prune,
which land first because deployment is what makes them urgent. Seven
sequential stacked PRs; agents commit and push their own branches; the
orchestrator opens all PRs at the end; the owner merges.

## The environment matrix (the product story everything serves)

| | Engine | Attachments | TLS/domain | Ships as |
|---|---|---|---|---|
| Demo (local) | SQLite file | local disk | — | `npm run dev` + seed (exists) |
| Production light | SQLite file | local disk | own reverse proxy, documented | `docker-compose.yml` + `docs/deployment.md` |
| Full-scale | PostgreSQL on RDS | S3 | own domain via the guide | `infrastructure/` Terraform |

Engine and storage are chosen by env and nothing else: `DATABASE_URL`
present → Postgres; `S3_BUCKET` present → S3 attachments. Absent → exactly
today's SQLite file and local `uploads/`. The locked "single container,
zero-config, backup is copying a folder" story is untouched for demo and
production light.

## Phase 1 — files policy + retention prunes (`feat/files-policy-and-prunes`)

- **Type allowlist**, in `packages/shared` beside the other vocabulary:
  images (png, jpg, jpeg, gif, webp, heic), pdf, office (doc, docx, xls,
  xlsx, ppt, pptx, odt, ods, odp), text (txt, csv, md, log), archives
  (zip, 7z, tar, gz). Enforced server-side on the sanitized extension →
  422 `file_type_not_allowed` naming the policy; the Dropzone's `accept`
  reads the same list. SVG deliberately absent (scriptable format; the
  forced-download headers make it safe to *serve*, but there is no reason
  to invite it).
- **Per-workspace storage quota**: `org_settings.upload_quota_mb`, default
  2048, admin-edited on the Settings page (bounded ≥ 100); enforcement is
  `sum(size_bytes) + incoming > quota` → 413 `storage_quota_exceeded`
  naming both numbers. Current usage appears on the Settings data card.
  No per-asset cap (deliberate cut — quota + the existing 10 MB/file
  covers the honest need).
- **`attachments.sha256`** column (migration), computed while the upload
  streams; included in the JSON export. Integrity/backup verification,
  not UI.
- **Orphan sweep** in the nightly maintenance job: list the storage,
  subtract the `stored_name` set, remove leftovers older than 24 h, log
  the count via pino (operations, not the activity log).
- **notification_log prune** in the same job: rows older than 12 months
  (every dedupe window is far shorter; 12 months keeps a year of "what
  was sent" for debugging).

## Phase 2 — the deployment guide (`feat/deployment-guide`)

`docs/deployment.md` (documentation only — no proxy shipped, per the
owner): the reverse-proxy contract (proxy → :3000; `APP_URL` = the public
https address; Secure cookies and the origin guard follow from it;
`TRUST_PROXY` so rate limits see real client IPs), copy-paste nginx and
Caddy examples, DNS, firewall, backup cron example, upgrade procedure,
health checks. README's deployment section links to it.

## Phases 3+4 — one async codebase, two engines

**Phase 3 (`feat/async-db-port`): better-sqlite3 → libsql.** Same SQLite
file format, same `/data/inventory.db`, same folder backup — but an async
API whose shape matches Postgres. Every service, plugin, CLI and test goes
`async`; `db.transaction(async (tx) => …)` at all 41 sites. The friendly
uniqueness pre-checks (asset tag, employee email, member email) stay for
UX but stop being the correctness story: **unique-constraint violations
are caught and translated to the same 422**, because under an async engine
the pre-check can race. The "better-sqlite3 is synchronous so this cannot
race" claims in comments and CLAUDE.mds are rewritten to the new truth.
Behavior is pinned by the existing test suite ported wholesale — the
phase is done when the full gate is green with zero behavioral diffs.
`@libsql/client` ships prebuilt binaries, so the Docker `--ignore-scripts`
story holds; the CI image job proves it.

**Phase 4 (`feat/postgres-engine`): the second engine.** One logical
schema, two dialect materializations: `db/schema.ts` (sqlite, exists) and
`db/schema.pg.ts` (pgTable twin), kept identical by a **parity test**
(same tables, same column names, same JS-facing types — pg `boolean`
mirrors sqlite's boolean-mode integer, timestamps stay ISO **text** in
both, money stays integer cents). Two checked-in migration sets
(`migrations/` + `migrations-pg/`); boot picks the migrator by engine.
The client factory returns the engine the env chose; **the pg database and
tables are cast to the sqlite-dialect types at exactly one documented
boundary** — type-sound because the JS-facing row types are identical by
the parity test, and runtime-sound because the pg objects really are
pgTable/NodePg all the way down. Services never know which engine runs
them. CI gains an api-test matrix leg against a real PostgreSQL service
container; locally those tests run when `PG_TEST_URL` is set and skip
otherwise. e2e stays on SQLite (the compose/demo path); the pg leg's
integration suite is the pg proof.

## Phase 5 — the S3 attachments driver (`feat/s3-attachments`)

A storage seam in the attachments service: `local` (default, byte-for-byte
today's code) or `s3` when `S3_BUCKET` is set (`S3_REGION` optional,
`S3_ENDPOINT` + path-style for MinIO-compatible stores). Uploads buffer at
most the existing 10 MB cap and `PutObject`; downloads stream **through
the app** so session auth and the forced-download headers keep working —
no presigned URLs reach a browser. Credentials via the standard AWS chain
(the EC2 instance role in full-scale; no keys in env for the happy path).
The orphan sweep and quota work against the seam, not the filesystem.
`@aws-sdk/client-s3` becomes an api dependency; unit/integration tests
inject a stubbed client; the real bucket is proven in Phase 6's AWS
validation.

## Phase 6 — `infrastructure/` (`feat/infrastructure`)

Flat, readable Terraform (providers, variables, vpc, ec2, rds, s3, iam,
dns, outputs, user_data template):

- VPC across two AZs; EC2 in a **public** subnet (IGW; no NAT gateway —
  the single biggest avoidable cost); RDS PostgreSQL (db.t4g.micro, 20 GB
  gp3, private subnets, not publicly accessible, automated backups);
  private S3 bucket (SSE, versioning); IAM instance profile scoped to
  that bucket + the SSM parameter; security groups (443/80 in, RDS only
  from the instance SG); Elastic IP; S3 gateway VPC endpoint (free).
- The DB password is generated by Terraform into an SSM SecureString; the
  instance's user_data reads it at boot and writes the app's env file —
  no secret in state outputs or instance user_data plaintext beyond the
  parameter name.
- `app_image` variable (default the ghcr name for when a release exists —
  none is published yet); `domain` variable optionally adds Route53 +
  ACM + ALB for TLS, otherwise HTTP on the EIP (the validation path).
- `infrastructure/README.md`: variables, outputs, cost (~$40–50/month at
  these sizes), scale-up knobs, and **teardown** front and center.
- A CI job: `terraform fmt -check` + `terraform validate` on
  infrastructure changes.
- **`docs/recipes/change-infrastructure.md`** — the AI-agent checklist the
  owner asked for: resize the instance, add the domain/TLS module, change
  region, restore RDS from a snapshot, rotate the DB password, where
  fmt/validate run in CI.
- **Validation on the owner's AWS** (account 8884…3671, eu-central-1):
  build the image locally, push to a temporary ECR repo, `terraform
  apply` with it, set up a workspace over the EIP, upload an attachment
  and verify the object in S3 and rows in RDS, restart the instance,
  then **`terraform destroy` plus an independent sweep proving nothing
  billable is left** (instances, RDS, EIPs, volumes, NAT — expect none —
  ECR repo, SSM parameters, buckets emptied first).

## Phase 7 — the README rewrite (`docs/readme-rewrite`)

Table of contents up top; the three environments as the backbone (demo →
production light → full-scale, each linking to its guide); every
instruction re-checked against what the phases changed; the screenshots
moved to a gallery **at the end**, per the owner. PROJECT_STATUS updated
locally (+ its out-of-repo backup), CLAUDE.mds already updated per phase.

## Delivery contract

Stacked branches in phase order, each based on the previous:
`feat/files-policy-and-prunes` ← `feat/deployment-guide` ←
`feat/async-db-port` ← `feat/postgres-engine` ← `feat/s3-attachments` ←
`feat/infrastructure` ← `docs/readme-rewrite`. **Agents commit AND push
their own branch** (never main, never merge); the orchestrator reviews
each phase, then opens all seven PRs at the end; the owner merges
bottom-up. Full gate per phase: `npm run lint && npm run format:check &&
npm run typecheck && npm test && npm run build && npm run e2e` (+ the
docker image proof where the image changed, + the pg matrix from Phase 4
on, + terraform fmt/validate in Phase 6). TDD for all app behavior;
config files exempt as always. This spec and its plan are deleted in the
final branch's last commit.

## Deliberate cuts

Hosted demo instance (still just hosting, unchanged in §7) · presigned
S3 URLs · per-asset storage caps · antivirus scanning (documented
decision, unchanged) · NAT gateways / multi-instance / ALB-by-default ·
PGlite (one embedded engine is enough, and it is the one we ship today) ·
automated SQLite→Postgres data migration (pre-release product; the CSV
import and JSON export are the bridge, said in the deployment guide).
