# Security policy

Inventory is a self-hosted product: it holds who has which device, the people
who sign in, and their password hashes and two-factor secrets. A weakness in it
is a weakness in every instance somebody runs, so reports are taken seriously
and handled quietly until a fix is out.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Use GitHub's
private reporting instead:

**[Report a vulnerability](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/security/advisories/new)**

That opens a draft advisory only the maintainer can see. Include what you found,
how to reproduce it, and which version or commit you were looking at. A minimal
reproduction — a request, a payload, a sequence of clicks — is worth more than a
long description.

This is a volunteer-maintained project. You will get an acknowledgement, then a
fix or a reasoned decision, as fast as one person can manage; the advisory is
where that conversation happens. When the fix ships as a release, the advisory
is published with credit to you unless you ask otherwise.

## What is in scope

- The application in this repository: the API, the web app, and the shared
  package.
- The container image and its entrypoint (`Dockerfile`, `docker-entrypoint.sh`).
- The deployment material under `infrastructure/` and `docs/`, where following
  it as written would leave an instance exposed.

## What is not

- An instance whose operator did not follow the deployment guides — plain HTTP
  in production, a proxy without `TRUST_PROXY`, a data directory the world can
  read. [`docs/deployment.md`](docs/deployment.md) says what a safe deployment
  looks like.
- Findings that require an already-privileged account to do what that account
  is allowed to do. Admins can see everything by design.
- Reports from automated scanners with no demonstrated impact.

## Supported versions

Fixes land on `main` and ship in the next release. Only the latest release is
supported; upgrading is pulling the newer image and restarting, and migrations
run at boot, so staying current is cheap.

## What is already in place

The design decisions that keep the common problems out are documented rather
than assumed: sessions and one-time tokens are stored only as hashes, the
origin guard stands in for CSRF tokens, uploads are allow-listed by extension
and always served as downloads rather than rendered, the container runs
unprivileged, and every mutation is audited in the same transaction. The root `CLAUDE.md` and `apps/api/CLAUDE.md`
describe each one, and a full review with its findings is recorded in the
project's history. If you think one of those decisions is wrong, that is a
report too.
