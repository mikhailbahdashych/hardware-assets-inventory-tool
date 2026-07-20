# Hardware Assets Inventory Tool

Open-source, self-hosted hardware asset inventory. Track your company's devices (laptops, phones, monitors, servers…), who holds them, and the full ownership history — deployed entirely inside your own infrastructure.

**Status: early development.** The stack below works; features are landing phase by phase.

- Backend: NestJS 11 + PostgreSQL 17 (TypeORM, REST under `/api/v1`)
- Frontend: Angular 22 + Angular Material
- Auth: local accounts, roles (admin/manager/viewer), TOTP MFA with recovery codes
- Deploy target: Docker Compose (separate web/api/db containers) behind your VPN/reverse proxy

## Deploy it

Coming with the production packaging phase: `git clone → cp .env.example .env → docker compose up -d`.

## Develop it

Prerequisites: Node 24 LTS, npm 10+, Docker.

```bash
npm install
npm run db:up     # Postgres 17 in Docker (localhost:5432, user/pass/db: inventory)
npm run dev       # API on :3000, web on :4200 (proxies /api to the API)
```

Open http://localhost:4200. Tests: `npm run test` and `npm run test:e2e`. Lint: `npm run lint`.

## Customize it with Claude Code

This repo is built to be modified with [Claude Code](https://claude.com/claude-code): `CLAUDE.md` files describe the architecture and conventions, and `.claude/skills/` (shipping in a later phase) will contain step-by-step skills for common customizations (add a field, add a status, build a report…). Open the repo in Claude Code and ask for what you want.

## Design

The approved design spec lives at [`docs/superpowers/specs/2026-07-18-inventory-app-design.md`](docs/superpowers/specs/2026-07-18-inventory-app-design.md).

## License

[MIT](LICENSE)
