<h1 align="center">Hardware assets tracking system for IT teams</h1>

Self-hosted, MIT licensed, and small enough that the whole install is one container over one directory: track devices, who holds them, and the full ownership history of every one. Every setting has a default, so an instance with no configuration at all runs and its first screen creates your organization — and when one machine stops being enough, `DATABASE_URL` moves the rows to PostgreSQL and `S3_BUCKET` moves the attachments to a bucket, without changing anything else about the app.

## Table of contents

- [What it is](#what-it-is)
- [Three ways to run it](#three-ways-to-run-it)
  - [Demo](#demo)
  - [Production light](#production-light)
  - [Full scale](#full-scale)
- [Configuration](#configuration)
  - [Running without email](#running-without-email)
  - [Backup and restore](#backup-and-restore)
- [Security](#security)
  - [Two-factor authentication](#two-factor-authentication)
- [Development](#development)
- [Screenshots](#screenshots)
- [License](#license)

## What it is

- **Assets** — tag, name, category, serial, status, purchase, warranty, supplier, notes, attachments and any custom fields you define. Filters live in the URL, so a filtered view is a link you can send someone.
- **Employees** — the people who hold devices. Separate from the accounts that sign in, optionally linked to them, because most staff never need a login.
- **Ownership history** — who had what, when, and how it came back. Held in one table that is the only truth about it; an asset's status and its open ownership record cannot disagree.
- **Custom statuses and workflow** — the statuses an asset can be in are yours, not ours: an admin adds, renames, recolours and reorders them, and draws the moves between them as a checkbox matrix with a live diagram beside it. The API enforces the graph, so taking an edge off it stops that move being offered _and_ stops it being accepted.
- **Custom roles and permissions** — who may do what is yours as well: an admin invents a role, colours it, writes the line that appears under its name on the invite card, and ticks what it may do in a matrix of every action the product has. Admin is the one locked row — it holds every permission, including the ones a later version adds — and nobody may edit the role they hold themselves. Permissions resolve per request, so a grant lands on that member's very next click, and the set the sidebar reads is the same one the API guard checks.
- **Members and invitations** — the accounts that sign in, each holding one of those roles, invited by email or by a copyable link.
- **Attachments** — the paperwork an inventory collects: invoices, photos, repair reports. Twenty-four file types are allowed and SVG is not one of them, 10 MB is the per-file cap, and the workspace's total is a quota an admin sets on the Settings page with the current usage beside it.
- **Activity log** — every mutation, rendered as a sentence, filterable and exportable as CSV.
- **Dashboard** — status counts that click through to a filtered list, fleet composition, recent activity, warranties running out, and what is due back.
- **⌘K** — search assets and people or run a command, entirely from the keyboard.
- **CSV import** — a mapping step, a dry run that names the row and column of every problem, then one transaction.
- **Email, optionally** — warranty alerts, return reminders, invitations, a weekly digest. All of it works without SMTP too; see [Running without email](#running-without-email).
- **Two-factor authentication** — TOTP, off by default, switched on for the whole workspace by an admin. Recovery codes included, and a break-glass command for the day somebody loses both. See [Two-factor authentication](#two-factor-authentication).

## Three ways to run it

One image, the same features in all three. What differs is where the rows and the files end up.

**Demo** is a checkout on your laptop. **Production light** is what this product is actually for: one container, one volume, a reverse proxy in front, on a small VM. **Full scale** is the same container with its rows in RDS and its attachments in S3, stood up by Terraform. Nothing in the application changes between the second and the third — two environment variables do.

### Demo

```bash
git clone https://github.com/mikhailbahdashych/hardware-assets-inventory-tool.git
cd hardware-assets-inventory-tool

npm install
npm run seed:demo     # optional: fill it with a demo workspace
npm run dev           # → http://localhost:5173
```

Node 22+. Two processes start — the API on `:3000` and Vite on `:5173`, which proxies to it — so **open `:5173`**. If you would rather install nothing but Docker, [`docs/development.md`](docs/development.md) has a route that needs exactly that.

A fresh instance is empty and lands on `/setup`, which is the real first-run experience but leaves every screen blank — and this app is largely about history. `npm run seed:demo` gives you a fictional company: twelve people, twenty-six devices, four months of assignments, returns and audit history. It prints one login per role — including the fourth one the workspace invented for itself — so you can see what each of them gets:

```
  Northwind Robotics is ready in /path/to/repo/data

  26 assets · 12 employees · 19 ownership records · 79 logged events

  ada.okafor@northwind.example    demo-password  (admin)
  marco.rossi@northwind.example   demo-password  (manager)
  lena.fischer@northwind.example  demo-password  (viewer)
  grace.chen@northwind.example    demo-password  (auditor)
```

Every date is relative to the moment you run it, so warranties are always about to lapse and returns are always about to fall due — the dashboard is never a museum. It refuses to touch a workspace that already has data; `npm run seed:demo -- --reset` replaces one. The seeder ships in the production image too (`node apps/api/dist/db/seed-demo-cli.js --reset`, honouring `DEMO_PASSWORD`), so a public demo instance can restore itself on a schedule.

**This repo is built to be customized by asking Claude Code.** Every area carries a `CLAUDE.md` explaining its patterns, and [`docs/recipes/`](docs/recipes/) has step-by-step checklists for the changes teams actually make — a new field, a new page, a new permission, a new email. Describe the change and let the session follow what is already written down.

### Production light

```bash
mkdir -p data
docker run -d --name inventory \
  -p 3000:3000 \
  -v ./data:/data \
  -e APP_URL=http://localhost:3000 \
  ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:latest
```

With compose, which is the same thing written down:

```bash
curl -O https://raw.githubusercontent.com/mikhailbahdashych/hardware-assets-inventory-tool/main/docker-compose.yml
mkdir -p data
docker compose up -d
```

Every release publishes the exact version, its `major.minor` and `:latest`, for amd64 and arm64 — `0.1.0`, `0.1` and `latest` today. `:latest` is the right tag to try it with and the wrong one to run it on: pin a version (`image: ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:0.1.0` in the compose file) so an upgrade is a decision you make, not a restart that made it for you. Running your own modifications is the same file from a checkout: the compose file carries `build: .` beside the image name, and `docker compose up -d --build` at the repository root builds the image from the source beside it instead of pulling one.

Whichever of them you ran, open <http://localhost:3000>: the first screen creates your organization and its first admin. That is the whole install.

`mkdir -p data` first because the container runs unprivileged as uid 1000 and may not take ownership of anything: a data directory the Docker daemon creates for you arrives owned by root, and then nothing inside the container can write it. Making it yourself makes it yours — which on a normal single-user Linux host is uid 1000 already. If it is not, `chown -R 1000:1000 data` once and it is settled; the container prints that line itself rather than dying on an unreadable permission error.

**Upgrading is `docker compose pull && docker compose up -d`.** Migrations run at every boot and are idempotent; there is no separate step and no maintenance mode.

Four things worth knowing before this is on the internet:

- **Put it behind a reverse proxy for TLS and set `APP_URL` to the public address.** [`docs/deployment.md`](docs/deployment.md) is the whole procedure — DNS, the four rules of the proxy contract, copy-paste Caddy and nginx blocks, firewall, backup cron, upgrades and health checks.
- **Single replica.** The scheduler runs in-process, so two containers on one database would both fire the nightly jobs. That holds on either engine: scale the machine, not the count.
- **Nothing in the container runs as root, `docker compose exec` sessions included** — every process, and every shell you open into a running instance, is uid 1000. The price is that the mounted data directory has to be writable by uid 1000 before the first start, because the container has no privilege left to fix it: create `./data` yourself, or `chown -R 1000:1000 ./data`. A container that finds it unwritable says so and stops, printing the fix.
- **`--user root` is the escape hatch, and it heals a mount in one run.** Started that way the entrypoint does what it always did — take ownership of the data directory, drop back to uid 1000 with `setpriv`, run the app — so `docker compose run --rm --user root inventory node -e ''` is enough to hand a stray directory over, after which normal starts work again.

### Full scale

When one machine stops being the answer — more people than one process should serve, attachments outgrowing a disk, or a compliance line that says the database cannot live on the same box as the app — [`infrastructure/`](infrastructure/README.md) is the other one. Flat Terraform for the AWS build: a VPC with no NAT gateway, an EC2 instance running this same image on an Elastic IP, RDS PostgreSQL 17 for the rows, and a private versioned S3 bucket for the attachments. Thirty-three resources, roughly $40 a month, and ten minutes or so to stand up — most of that is RDS, which is also what makes the number move; the apply that proved this stack took 6m22s up and 4m34s down. Its README carries the variables, the cost arithmetic, how to reach the instance without SSH, and the teardown — read [Tearing it down](infrastructure/README.md#tearing-it-down) before the first apply, because a versioned bucket refuses to be deleted while a single object version is left in it, and that flag is read from state rather than from the command line.

**Nothing in the app changes; two environment variables do**, and the stack exists to produce them correctly. `DATABASE_URL` is the whole engine choice — absent, the rows are in the SQLite file under `DATA_DIR`; a `postgres://` URL puts them in PostgreSQL, and the schema, the API and every screen are the same either way, migrations included. `S3_BUCKET` is the same switch for the files — absent, uploads are files under `DATA_DIR`; naming a bucket sends them there instead, while downloads still stream through the app under a session, because no presigned URL ever reaches a browser. Credentials come from the standard AWS chain, which in that stack is the instance's own role.

**There is no automated SQLite→PostgreSQL data path before 1.0.** Moving an existing workspace across is an export and a CSV import — and ownership history, attachment bytes and passwords do not travel that way. [Moving up](docs/deployment.md#moving-up) in the deployment guide is honest about what that costs. Choose the engine when you stand the instance up, and if that is more than you are willing to lose, stay on production light until the path exists.

**Two things to settle before the first apply.** By default the app answers on that Elastic IP over **plain HTTP** — which is the transport for `/setup`, for every sign-in and for the session cookie that comes back — so the default address is one to finish setup on and not one to hand around. Set `domain` and `route53_zone_id` and the stack grows an Application Load Balancer with an ACM certificate, `APP_URL` becomes `https://<domain>`, and the instance stops answering the world directly; [Before you call it production](infrastructure/README.md#before-you-call-it-production) is the short list that starts there. And `app_image`: it defaults to `:latest`, the tag to try with and not the one to run on — pin a release there too, and mind that a Terraform apply against a tag that does not exist _succeeds_, prints an address, and leaves it answering nothing.

[`docs/recipes/change-infrastructure.md`](docs/recipes/change-infrastructure.md) is the checklist for changing the stack afterwards — resize, re-region, rotate, restore.

## Configuration

Every value has a default. An instance with no configuration at all runs; this table is for the day it has to be reachable from somewhere else, keep its rows in a database server, or send email.

| Variable                  | Default                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`                            | Port the server listens on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `HOST`                    | `0.0.0.0`                         | Interface to bind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `DATA_DIR`                | `./data`; the image sets `/data`  | What it holds depends on the two switches below. By default, the SQLite file **and** the attachments — the one directory to back up. With `DATABASE_URL`, the attachments alone; with `S3_BUCKET`, the SQLite file alone — and the bucket is the other half of the backup. With both, nothing that matters — but it must exist and be writable even then, because the entrypoint probes it at boot.                                                                                                                             |
| `DATABASE_URL`            | —                                 | Absent, the rows live in the SQLite file under `DATA_DIR`. A `postgres://` or `postgresql://` URL puts them in PostgreSQL instead. The scheme is checked at boot rather than at the first query, so a URL this app cannot talk to fails immediately.                                                                                                                                                                                                                                                                            |
| `APP_URL`                 | `http://localhost:3000`           | Where a browser reaches this instance. Invitation and reset links are built from it, the origin guard compares every mutation against it, and an `https://` value switches session cookies to `Secure` on its own.                                                                                                                                                                                                                                                                                                              |
| `COOKIE_SECURE`           | derived from `APP_URL`            | Override, for a proxy that terminates TLS in a way the URL does not describe.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `LOG_LEVEL`               | `info`                            | pino level.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `TRUST_PROXY`             | `false`                           | A hop count when something terminates TLS in front: `1` for one proxy directly ahead of the app. Rate limits are keyed on the client address, and without this every request behind a proxy shares one bucket. `true` trusts the whole `X-Forwarded-For` chain and believes its left-most entry, which is right only for a proxy that _replaces_ the header — nginx and an AWS load balancer append to it, and then the client picks its own address. A comma-separated list of your proxies' addresses is the precise version. |
| `TZ`                      | container default                 | The scheduled jobs run on wall-clock time, so this decides when 08:00 is.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `S3_BUCKET`               | —                                 | Absent, attachments are files under `DATA_DIR`. Naming a bucket is the whole switch; downloads still come through the app under a session.                                                                                                                                                                                                                                                                                                                                                                                      |
| `S3_REGION`               | —                                 | The bucket's region. How AWS is addressed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `S3_ENDPOINT`             | —                                 | An http(s) URL, for MinIO and the other S3-compatible stores. AWS needs neither this nor the next one.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `S3_FORCE_PATH_STYLE`     | `false`                           | Path-style addressing, which those stores usually want as well.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SMTP_HOST`               | —                                 | Set it and the instance can send email. Leave it and it cannot; nothing else changes.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SMTP_PORT`               | `587`                             | `465` implies TLS on its own.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SMTP_SECURE`             | derived from the port             | Force implicit TLS on or off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SMTP_USER` / `SMTP_PASS` | —                                 | Both or neither; a relay on a private network usually wants neither.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SMTP_FROM`               | `Inventory <inventory@localhost>` | The From header, as written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

There are deliberately no S3 key variables: credentials come from the standard AWS chain — an instance role, a profile, or the usual `AWS_*` environment — so the deployment that has a role never has to write a secret down. [`.env.example`](.env.example) is the same list with the reasoning in comments.

### Running without email

This is a first-class way to run it, not a degraded one.

- **Invitations** come back as a link the admin copies and hands over.
- **Password resets** are the same: an admin issues a link from the Members page. `/auth/forgot-password` always answers 204 and issues nothing, because a reset link must never be handed to whoever asked for it.
- **Everything that would email** — the invite checkbox, the assign and check-in notifications, the four notification switches — shows disabled with the reason where the control is.

### Backup and restore

**On the default single container, back up `DATA_DIR`.** The SQLite file and the attachments are both in it and there is nothing else — no external cache, no queue, no secret at rest. [`docs/backup-restore.md`](docs/backup-restore.md) has the cold copy, the hot `.backup` variant that needs no downtime, the restore, and why the JSON export is **not** a backup.

**With `DATABASE_URL` and `S3_BUCKET`, the two halves are backed up where they live** — for the Terraform stack that means RDS automated backups with point-in-time recovery inside their window, and the bucket's own versioning. The catch is that nothing snapshots the two together; [`docs/backup-restore.md`](docs/backup-restore.md#postgresql-and-s3) says what that means for a restore, and [`infrastructure/README.md`](infrastructure/README.md#backups) has the AWS specifics.

## Security

- Sessions and invite/reset tokens are stored as `sha256(raw)`. The database holds no password hashes it did not make, no signing secret, and no raw token.
- Passwords are argon2id.
- Same-origin only. No CORS anywhere, `SameSite=Lax` cookies, and an origin guard that rejects a mutation carrying a foreign `Origin` or `Referer`. That is the CSRF stance; there are no CSRF tokens because there is nothing cross-origin to defend.
- Login answers identically for a wrong password, an unknown email and an inactive account, and pays for one argon2 verify either way so timing says nothing.
- Rate limits on login, password reset and invite acceptance.
- **Uploads answer to a policy.** An extension allowlist — twenty-four types, and SVG deliberately not among them, because a scriptable format has no business on the volume in the first place. A 10 MB cap per file and a workspace-wide quota an admin sets, 2 GB by default. Every file is stored under a name the server generates, its sha256 recorded as the bytes stream past, and served as `content-disposition: attachment` with `nosniff`, so an upload can never run as a page in the app's origin. The same list drives the file picker, so the browser greys out what the server would refuse.
- Nightly maintenance is the only thing that removes rows nobody asked it to: expired sessions, spent tokens, audit events past the workspace's retention setting, notification-log rows past a year, and stored files that no attachment row names.
- Logs are pino JSON and hold no secrets — the one route with a raw token in its path is redacted before a line is written.

### Two-factor authentication

Off by default. An admin turns it on for the whole workspace in **Admin → Settings → Security**, and from that moment every member — existing sessions included, on their next request — has to set up an authenticator before they can do anything else.

- **TOTP**, so any authenticator works: 1Password, Bitwarden, Aegis, Google Authenticator. Enrolment shows a QR and the key in text for entering by hand.
- **Ten recovery codes**, shown once and stored only as hashes. Each works once, in place of a code from the app.
- **A spent set replaces itself at the next sign-in.** Sign in with your last recovery code and ten fresh ones arrive with it, on that screen, once. An admin can arm the same thing from the Members page — "Reset recovery codes" empties the set without touching the authenticator, so nobody is signed out and the new set is handed to the member themselves.
- **The Members page says where everybody stands**: who is enrolled, and how many codes they have left.
- **Only admins reset it**, from the Members page. There is no self-service reset, because a second factor you can clear with a stolen password is not a second factor.
- **Turning the requirement off deletes every stored secret and recovery code.** A disabled second factor that quietly kept its secrets would come back on with authenticators nobody remembers adding.

If the last admin loses both their phone and their recovery codes, break glass from the host:

```bash
docker compose exec inventory node apps/api/dist/db/mfa-reset-cli.js admin@example.com
```

That needs shell access to the instance, which already carries whatever the app runs with — the SQLite file, or the database credential. It grants nothing that was not already possible, it just makes it survivable.

## Development

Two ways to run it locally, and they do the same thing. The Node one is the commands under [Demo](#demo); the other needs nothing but Docker, which is also the answer on Windows, where `cmd.exe` cannot parse the env vars the npm scripts set inline. Full instructions in [`docs/development.md`](docs/development.md).

**With only Docker:**

```bash
docker compose -f docker-compose.dev.yml run --rm app npm run seed:demo
docker compose -f docker-compose.dev.yml up     # → http://localhost:5173
```

Either way the API runs on `:3000` and Vite on `:5173` and proxies to it — **open `:5173`**. Both give you hot reload; the Docker one mounts your checkout, so editing a file on the host still restarts the API and refreshes the browser.

```bash
npm test           # unit and integration, all workspaces
npm run e2e        # Playwright against a production build
npm run lint && npm run typecheck && npm run format
```

The API's suite runs against either engine, which is what keeps the two schema materializations honest. `npm test` uses SQLite; `npm run test:pg` runs the same tests against PostgreSQL, on `postgres://postgres:test@localhost:5433/postgres` unless `DATABASE_URL` says otherwise — one `docker run -d -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:17` away. CI runs both, as two jobs, so a failure names its engine.

**`http://localhost:5173/kitchen-sink` is the design system.** Colour tokens with their resolved values, the type scale, the whole icon inventory, and every primitive in every state it ships with — in both themes and both densities. Open it beside whatever you are changing. It is a dev-only route, excluded from production builds, and it cannot drift from the app because it renders the same components.

Read [`CLAUDE.md`](CLAUDE.md) first, then the one next to the code you are changing — each area has its own, and together they are what a Claude Code session follows. [`docs/recipes/`](docs/recipes/) has an end-to-end checklist for the changes teams make most.

## Screenshots

![The Inventory dashboard: a tile per asset status, assets broken down by category, recent activity, warranties running out and returns due back](media/dashboard.png)

_The demo workspace, as `npm run seed:demo` leaves it._

![The asset list: a filter pill per status carrying its own count, and a column naming who currently holds each device](media/assets.png)

_The pills carry their counts, so the shape of the fleet is readable before you filter anything._

![The detail page for one laptop: specification, custom fields, its current holder, an ownership timeline and the audit trail for that asset](media/asset-detail.png)

_AST-0001 has had two holders and a spell on the shelf between them. The "In stock" gap is derived from the ownership rows rather than stored, which is why it cannot disagree with them._

![The Workflow page: seven statuses with their colours and two behaviour toggles each, above a from-to checkbox matrix, with a node-and-arrow diagram of the same graph beside it](media/workflow.png)

_The demo workspace's own workflow. Northwind added "In imaging" for machines being wiped between holders, and drew the graph so a retired device has no way back out. The diagram is fed the checkboxes rather than the saved rows, so it redraws as you tick._

![The Change status modal for a laptop that is in repair, its status list open and offering only Available and Retired](media/workflow-change-status.png)

_The same graph, one screen later: In repair has two edges leaving it, so those are the two moves on offer — and the only two the API would accept if you asked another way._

![The Roles page: four roles with their colours, descriptions and member counts, above a matrix of every action with a checkbox per role](media/roles.png)

_The demo workspace's own roles. Northwind wanted somebody in finance to read the log and pull the export without being able to touch the inventory, so it added Auditor and ticked exactly two boxes — both further down the matrix, under Data and Administration. The Admin column is ticked and locked the whole way, because its set is every action there is, by definition rather than by rows._

![The Invite member modal: a radio card per role, each with the description its admin wrote, above the email field](media/roles-invite.png)

_Everywhere a role is named reads the same table, so a role invented at four o'clock is on the invite form at four o'clock, with the words its admin wrote. The card selected by default is the one granting the fewest actions, not a slug the code knows._

![The activity log: filter pills counting assets, people, auth and system events, above a table of events written as sentences](media/activity-log.png)

_Every mutation, written as a sentence by the same renderer that produces the CSV export — so the screen and the file cannot drift apart._

![The command palette open over the dashboard, one query matching both assets and an employee, grouped under separate headings](media/command-palette.png)

_⌘K from anywhere. Results group by what they are, and the same list runs commands._

![The dashboard again in dark theme, with the same tiles, category bars and widgets](media/dashboard-dark.png)

_Both themes ship. Signed in, it follows the preference stored with your account and travels between browsers with you; before that, it takes whatever your system asks for._

## License

MIT — see [`LICENSE`](LICENSE).
