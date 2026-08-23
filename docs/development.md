# Running it locally

Two ways. They do the same thing — the whole app, hot reload, a demo workspace to look at — and differ only in what has to be installed on your machine.

|                     | **Native**            | **Docker**                           |
| ------------------- | --------------------- | ------------------------------------ |
| You need            | Node 22+ and npm      | Docker, and nothing else             |
| First run           | ~1 min                | ~2 min (it builds an image)          |
| Hot reload          | yes                   | yes                                  |
| Speed after that    | fastest               | a little slower, bind-mounted source |
| Windows             | needs WSL (see below) | works as-is                          |
| Where the data goes | `./data`              | a Docker volume                      |

If you just want to look at the app, either is fine. If you are going to work on it, prefer native.

---

## Native

```bash
git clone https://github.com/mikhailbahdashych/hardware-assets-inventory-tool.git
cd hardware-assets-inventory-tool

npm install
npm run seed:demo     # optional, but do it — see below
npm run dev
```

Open **<http://localhost:5173>**.

Two processes start: the API on `:3000` and Vite on `:5173`, which proxies `/api` to it. **Open the Vite port**, not the API's — the app is served from there in development, and session cookies and invitation links are built around that origin.

The API binds to `127.0.0.1` on purpose. It is only ever reached through the proxy, and a dev instance listening on every interface is an un-set-up workspace offered to everyone else on the network.

## Docker

```bash
git clone https://github.com/mikhailbahdashych/hardware-assets-inventory-tool.git
cd hardware-assets-inventory-tool

docker compose -f docker-compose.dev.yml run --rm app npm run seed:demo
docker compose -f docker-compose.dev.yml up
```

Open **<http://localhost:5173>**. Same two processes, same ports, inside one container. Your checkout is mounted, so editing a file on the host restarts the API and refreshes the browser exactly as it does natively.

`Ctrl-C` stops it. `docker compose -f docker-compose.dev.yml down -v` stops it and throws the data away.

> This is not the deployment. [`docker-compose.yml`](../docker-compose.yml) is — it runs the built image with no toolchain in it and no source mounted. `docker-compose.dev.yml` exists to give you tsx and vite without installing them.

---

## The demo workspace

A fresh instance is empty and lands on `/setup`, where you create an organization and its first admin. That is the real first-run experience, and it takes ten seconds.

It also means every screen is empty, and this app is largely about history — who held what, what changed, what is about to expire. `npm run seed:demo` fills it in:

```
  Northwind Robotics is ready in /path/to/repo/data

  26 assets · 12 employees · 19 ownership records · 79 logged events

  ada.okafor@northwind.example    demo-password  (admin)
  marco.rossi@northwind.example   demo-password  (manager)
  lena.fischer@northwind.example  demo-password  (viewer)
  grace.chen@northwind.example    demo-password  (auditor)
```

Sign in as any of the four to see what that role can do — the viewer has no mutation affordances anywhere, the manager has no Admin section, and Auditor is the role the demo workspace invented for itself on the Roles page: two ticks, so the activity log and the export open and nothing else does.

Every date is relative to the moment you ran it, so warranties are always about to lapse and returns are always about to fall due. It refuses to touch a workspace that already has data; `npm run seed:demo -- --reset` replaces one. The `--` is not decoration: without it npm reads `--reset` as a flag of its own and the seeder never sees it, which looks exactly like the refusal you were trying to answer. That holds in Docker too, where the whole command is `docker compose -f docker-compose.dev.yml run --rm app npm run seed:demo -- --reset`.

**Starting over completely:** delete `./data` natively, or `docker compose -f docker-compose.dev.yml down -v` in Docker. Both leave you at `/setup` again.

---

## Everything else you can run

```bash
npm test                 # unit + API integration, all workspaces
npm run e2e              # Playwright against a production build
npm run lint             # ESLint
npm run typecheck        # tsc across workspaces
npm run format           # Prettier
npm run build            # production build
```

In Docker, put `docker compose -f docker-compose.dev.yml run --rm app` in front of any of them.

**`http://localhost:5173/kitchen-sink`** is the design system — tokens, type scale, icons, every primitive in every state, in both themes and densities. It is a dev-only route. Open it beside anything you are changing to the UI.

---

## When it does not work

**Something else is on port 3000 or 5173.** The API fails with `EADDRINUSE`. Find it with `lsof -i :5173`, or run the other setup — Docker publishes the same two ports, so the native and Docker stacks cannot both be up at once.

**`npm install` printed "packages have install scripts not yet covered by allowScripts".** npm 11 and newer block install scripts by default. That is fine here: `libsql` (the driver under `@libsql/client`), `@node-rs/argon2` and `esbuild` all ship prebuilt binaries in platform packages npm picks for you. If your platform has no prebuilt binary you will see it fail at first use rather than at install, and the fix is `npm install --foreground-scripts` plus a C++ toolchain.

**`invalid ELF header`, or a native module that will not load, in Docker.** Something mounted the host's `node_modules` into the container. The compose file shadows every one of them with a volume for exactly this reason; if you have edited it, put those lines back. `docker compose -f docker-compose.dev.yml build --no-cache` to start clean.

**Node is older than 22.** `libsql` and the API's ESM entry both assume it. `nvm use` reads the `.nvmrc`.

**Windows.** The npm scripts set environment variables inline (`HOST=… tsx watch`), which is POSIX shell syntax that `cmd.exe` does not understand. Use WSL, or use the Docker setup — that is one of the reasons it exists.

**The app loads but every request 403s.** You opened `:3000` instead of `:5173`. The origin guard rejects a mutation whose `Origin` is not the app's own, and in development the app's origin is Vite's.

---

## What lives where

- `apps/web` — React SPA. Design system, pages, modals.
- `apps/api` — Fastify + SQLite. REST under `/api/v1`, sessions, RBAC, the audit log.
- `packages/shared` — enums, label and colour maps, RBAC, zod schemas. Both apps import it.
- `e2e` — Playwright, against a production build.
- `./data` — the SQLite file and uploaded attachments. Gitignored; delete it to start over.

Each of those has a `CLAUDE.md` explaining its patterns, and [`docs/recipes/`](recipes/) has step-by-step checklists for common changes. They are written for Claude Code, and they read fine as documentation for a person.
