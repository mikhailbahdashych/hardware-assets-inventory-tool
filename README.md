# Inventory — hardware asset tracking for IT teams

Self-hosted, single container, SQLite. Track devices, who holds them, and the full ownership history of every one.

Built to be **customized by asking Claude Code**: every area of the repo carries a `CLAUDE.md` explaining its patterns, and [`docs/recipes/`](docs/recipes/) has step-by-step checklists for the changes teams actually make — a new field, a new status, a new page, a new email.

MIT licensed.

---

## Quick start

```bash
docker run -d --name inventory \
  -p 3000:3000 \
  -v ./data:/data \
  -e APP_URL=http://localhost:3000 \
  ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:latest
```

Open <http://localhost:3000> and the first screen creates your organization and its first admin. That is the whole install.

With compose, which is the same thing written down:

```bash
curl -O https://raw.githubusercontent.com/mikhailbahdashych/hardware-assets-inventory-tool/main/docker-compose.yml
docker compose up -d
```

**Upgrading is `docker compose pull && docker compose up -d`.** Migrations run at every boot and are idempotent; there is no separate step and no maintenance mode.

## What it does

- **Assets** — tag, name, category, serial, status, purchase, warranty, supplier, notes, attachments, and any custom fields you define. Filters live in the URL, so a filtered view is a link you can send someone.
- **Employees** — the people who hold devices. Separate from the accounts that sign in, optionally linked to them, because most staff never need a login.
- **Ownership history** — who had what, when, and how it came back. Held in one table that is the only truth about it; an asset's status and its open ownership record cannot disagree.
- **Members and invitations** — three roles (Admin / Manager / Viewer), invite by email or by a copyable link.
- **Activity log** — every mutation, rendered as a sentence, filterable and exportable as CSV.
- **Dashboard** — status counts that click through to a filtered list, fleet composition, recent activity, warranties running out, and what is due back.
- **⌘K** — search assets and people or run a command, entirely from the keyboard.
- **CSV import** — a mapping step, a dry run that names the row and column of every problem, then one transaction.
- **Email, optionally** — warranty alerts, return reminders, invitations, a weekly digest. All of it works without SMTP too; see below.

## Configuration

Every value has a default. An instance with no configuration at all runs.

| Variable                  | Default                           | What it does                                                                                                                                              |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | `3000`                            | Port the server listens on.                                                                                                                               |
| `HOST`                    | `0.0.0.0`                         | Interface to bind.                                                                                                                                        |
| `DATA_DIR`                | `/data`                           | SQLite file and uploaded attachments. **The one directory to back up.**                                                                                   |
| `APP_URL`                 | `http://localhost:3000`           | Where a browser reaches this instance. Invitation and reset links are built from it; an `https://` value switches session cookies to `Secure` on its own. |
| `COOKIE_SECURE`           | derived from `APP_URL`            | Override, for a proxy that terminates TLS in a way the URL does not describe.                                                                             |
| `LOG_LEVEL`               | `info`                            | pino level.                                                                                                                                               |
| `TZ`                      | container default                 | The scheduled jobs run on wall-clock time, so this decides when 08:00 is.                                                                                 |
| `SMTP_HOST`               | —                                 | Set it and the instance can send email. Leave it and it cannot; nothing else changes.                                                                     |
| `SMTP_PORT`               | `587`                             | `465` implies TLS on its own.                                                                                                                             |
| `SMTP_SECURE`             | derived from the port             | Force implicit TLS on or off.                                                                                                                             |
| `SMTP_USER` / `SMTP_PASS` | —                                 | Both or neither; a relay on a private network usually wants neither.                                                                                      |
| `SMTP_FROM`               | `Inventory <inventory@localhost>` | The From header, as written.                                                                                                                              |

### Running without email

This is a first-class way to run it, not a degraded one.

- **Invitations** come back as a link the admin copies and hands over.
- **Password resets** are the same: an admin issues a link from the Members page. `/auth/forgot-password` always answers 204 and issues nothing, because a reset link must never be handed to whoever asked for it.
- **Everything that would email** — the invite checkbox, the assign and check-in notifications, the four notification switches — shows disabled with the reason where the control is.

## Security

- Sessions and invite/reset tokens are stored as `sha256(raw)`. The database holds no password hashes it did not make, no signing secret, and no raw token.
- Passwords are argon2id.
- Same-origin only. No CORS anywhere, `SameSite=Lax` cookies, and an origin guard that rejects a mutation carrying a foreign `Origin` or `Referer`. That is the CSRF stance; there are no CSRF tokens because there is nothing cross-origin to defend.
- Login answers identically for a wrong password, an unknown email and an inactive account, and pays for one argon2 verify either way so timing says nothing.
- Rate limits on login, password reset and invite acceptance.
- Uploaded files are stored under a name the server generates and always served as `content-disposition: attachment` with `nosniff`, so an upload can never run as a page in the app's origin.

## Backup and restore

Copy `DATA_DIR`. See [`docs/backup-restore.md`](docs/backup-restore.md), which also covers doing it without stopping the container and why the JSON export is **not** a backup.

## Deployment notes

- **Single replica.** The scheduler runs in-process and SQLite is one file; two containers on one volume would both fire the nightly jobs. Scale the machine, not the count.
- **The mounted data directory is taken over on start.** The container's entrypoint runs as root only long enough to `chown` it, then drops to an unprivileged user — so `-v ./data:/data` works whoever owns the directory on the host. Starting the image with an explicit `--user` skips that, and then the directory has to be writable by that user already.
- Put it behind a reverse proxy for TLS and set `APP_URL` to the public address.
- Roughly 10,000 assets is the point where the unpaginated list endpoints stop being comfortable. Past that, open an issue — the schema is ready for Postgres, the code is not yet.

## Development

```bash
npm install
npm run dev        # api :3000, web :5173 (Vite proxies /api)
npm test           # unit and integration, all workspaces
npm run e2e        # Playwright against a production build
npm run lint && npm run typecheck && npm run format
```

`docs/design-handoff/` holds the interactive prototype that is the visual source of truth — open it beside the app when changing UI. `http://localhost:5173/kitchen-sink` renders every primitive for comparison.

Read [`CLAUDE.md`](CLAUDE.md) first, then the one next to the code you are changing. [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) records what is built and what was decided.

## Not in this version

Documented so nobody goes looking: OIDC/SSO, a Postgres option, API tokens, pagination past ~10k assets, and a category-management UI. The category list is a code-only change today — see [`docs/recipes/add-asset-status.md`](docs/recipes/add-asset-status.md), which works the same way for categories.
