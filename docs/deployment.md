# Deploying it

Production light: **one container, one volume, and a reverse proxy you put in front of it.** A small VM is enough — the app is a single Node process over a SQLite file, and the only thing that grows on its own is the attachments directory.

The image ships no proxy and terminates no TLS, on purpose. Certificates, redirects, HTTP/2 and whatever else your edge already does are the edge's job; this guide is the contract between it and the container, and it is short.

**Single replica, always.** The scheduled jobs run in-process and SQLite is one file, so two containers on one volume would both fire the nightly jobs and both write the database. Scale the machine, not the count.

## DNS

One A record, pointing at the host's public address:

```
inventory.example.com.   A   203.0.113.10
```

An AAAA record too if the host has IPv6. Nothing exotic — no wildcard, no CNAME chain.

Do it **first**. Both proxies below get their certificate over an HTTP-01 challenge, which is a certificate authority resolving that name and connecting to it on port 80. The record has to be right before the proxy first starts: a name that does not resolve to this host is a refused issuance, and repeated failures are themselves rate-limited by the authority.

```bash
dig +short inventory.example.com
```

## The container

Everything lives in one directory on the host — `/srv/inventory` in this guide:

```bash
mkdir -p /srv/inventory/data
cd /srv/inventory
curl -O https://raw.githubusercontent.com/mikhailbahdashych/hardware-assets-inventory-tool/main/docker-compose.yml
```

`mkdir -p data` before the first start, because the container is unprivileged (uid 1000) and may not take ownership of anything: a data directory the Docker daemon creates for you arrives owned by root, and then nothing inside the container can write it. If it ends up owned by somebody else anyway, the container says so on start and prints the two fixes rather than dying on an unreadable error.

Then set the two values a public deployment needs — the next section is what they mean:

```yaml
services:
  inventory:
    image: ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:latest
    restart: unless-stopped
    ports:
      # Loopback only. The proxy is the way in, and a published port is not
      # something a host firewall will save you from — see "Firewall" below.
      - '127.0.0.1:3000:3000'
    volumes:
      - ./data:/data
    environment:
      APP_URL: https://inventory.example.com
      TRUST_PROXY: '1'
      # The nightly jobs run on wall-clock time, so this decides when 08:00 is.
      TZ: Europe/Berlin
```

```bash
docker compose up -d
```

The file you downloaded also carries `build: .`, so from a checkout of the repo `docker compose up -d --build` deploys the image that checkout builds — the same deployment, from your own bytes.

**Finish `/setup` before you hand the address to anybody.** A fresh instance is empty and its first screen creates the organization and its first admin — it answers 409 to everyone afterwards, so whoever reaches it first is the admin. That is a ten-second window you should close yourself.

## The reverse-proxy contract

Four rules, and the app asks for nothing else.

**1. Forward everything to port 3000.** One process serves both halves — the REST API under `/api/v1` and the SPA that calls it come out of the same port, so there is nothing to split and no static host to configure. No websockets, no long-poll, no streaming endpoints.

**2. Pass `Host` through, and the client's address in `X-Forwarded-For`.** nginx replaces `Host` with the upstream it is proxying to unless told otherwise; Caddy keeps the original. Nothing in the app decides anything from `Host` — the origin guard compares against `APP_URL` and nothing else, deliberately, because `Host` is whatever the caller typed — so passing it is hygiene rather than a requirement, and it costs one line. `X-Forwarded-For` is the one that matters, and rule 4 is why.

**3. `APP_URL` is exactly the address a browser uses.** Scheme, host, and the port if it is not the default — `https://inventory.example.com`, with no trailing path. Two things hang off it, and both fail in ways that look like something else:

- **The origin guard.** Every mutating request is checked: the browser's `Origin` (or `Referer`) must parse to the same origin as `APP_URL`, exactly, or it is a 403. That is the CSRF stance here — same-origin only, no tokens — and because it compares against that one value and nothing else, a wrong `APP_URL` is not a warning you can live with, it is an app where nothing saves. `/setup` included: get it wrong and the very first screen refuses. The 403 names the origin the instance expects, which is the fastest way to see what you typed. `www.` counts. The port counts. `http` versus `https` counts.
- **Secure cookies.** An `https://` value marks the session cookie `Secure` on its own; nothing else has to be set. `COOKIE_SECURE` overrides that, and exists for the deployment whose public scheme `APP_URL` does not describe.

The default is `http://localhost:3000`, which is right for a laptop and wrong for everything else. A production instance still carrying it prints a warning to stderr on boot naming this variable.

**4. `TRUST_PROXY=1` behind a proxy — and never without one.** It decides what the app believes the client's address is, and the rate limits are keyed on that: ten sign-in attempts per 15 minutes, five password-reset requests an hour, ten invite or reset token uses an hour, each per address.

Behind a proxy without it, every request in the world arrives as the proxy's own address and shares one bucket — ten bad passwords from one stranger lock the whole workspace out for fifteen minutes. Set on an instance with nothing in front of it, it is worse: `X-Forwarded-For` is then a header any client writes for itself, so an attacker takes a fresh address per attempt and the limits stop existing. That is why it is off by default and per deployment.

**A hop count, and not `true`, which is the value most guides print.** `true` means "trust every entry in `X-Forwarded-For`", and the app then reads the left-most one as the client — correct only for a proxy that _replaces_ the header. The nginx block below appends instead: `$proxy_add_x_forwarded_for` is "whatever arrived, plus the address I saw", so under `true` a caller who sends their own `X-Forwarded-For` names their own address, takes a fresh rate-limit bucket per request, and writes your log for you. `1` is one proxy directly in front — the address the app believes is then the one your proxy actually saw. Two proxies in a chain is `2`, and a comma-separated list of your proxies' own addresses is the precise version if you know them. This is also what decides the `ip` field in every request log line, which is the other reason to want it right.

## The proxy itself

Both of these are complete. Pick one.

### Caddy

`/etc/caddy/Caddyfile`:

```caddy
inventory.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

That is genuinely the whole file. Caddy obtains and renews the certificate itself, redirects `http://` to `https://`, keeps the original `Host` header, and sets `X-Forwarded-For` and `X-Forwarded-Proto` on its own — the entire contract above, by default. It has no request body limit, so a 10 MB attachment goes through untouched.

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Add a global block with `email you@example.com` above the site if you want the certificate authority to have an address for expiry warnings; issuance works without one.

### nginx

Get the certificate first. The `.well-known` location in the port-80 block below is what answers the challenge:

```bash
mkdir -p /var/www/html
certbot certonly --webroot -w /var/www/html -d inventory.example.com \
  --deploy-hook "systemctl reload nginx"
```

The deploy hook matters: `certonly` records no installer, so without it nothing reloads nginx when the certificate renews — it keeps serving the old one until it expires, which is how a renewal that worked perfectly becomes an outage.

`/etc/nginx/conf.d/inventory.conf`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name inventory.example.com;

    # The renewal challenge, which must stay reachable over plain http.
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;   # nginx 1.25.1 and newer; before that: `listen 443 ssl http2;`
    server_name inventory.example.com;

    ssl_certificate     /etc/letsencrypt/live/inventory.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/inventory.example.com/privkey.pem;

    # The app caps an attachment at 10 MB; nginx's default body limit is 1 MB,
    # so without this the proxy refuses uploads the app would have accepted.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

`X-Forwarded-Proto` is there by convention rather than necessity — the app takes its scheme from `APP_URL`, not from a header a client could write.

Neither block sends `Strict-Transport-Security`, and neither does the app. HSTS is a promise about your whole domain, including every other name under it, so it belongs to whoever owns the domain rather than to this guide.

## Firewall

Inbound: your administrative port, 80 and 443. Nothing else.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable
```

**Port 80 stays open** even though everything on it redirects: it is where the certificate renewal challenge lands.

**Port 3000 must not be reachable from outside**, and the port mapping is what settles that, not the firewall. Docker publishes a port by writing DNAT rules that are consulted before ufw's rules are, so `ufw deny 3000` on a port published to `0.0.0.0` is a rule nobody reads. Binding the mapping to `127.0.0.1:3000:3000` is the fix, because there is then nothing on the public interface to filter.

If your proxy runs in Docker too, better still: delete the `ports:` block entirely, put both containers on one network, and let the proxy reach `inventory:3000`. The app then has no host port at all.

From another machine, this should refuse or time out — and if it answers, the app is on the public internet without a proxy in front of it:

```bash
curl -m 5 http://203.0.113.10:3000/api/v1/healthz
```

## Backups

Everything the app keeps is in `./data` — the SQLite file and the uploaded attachments. Back up that directory and you have backed up the product; [`docs/backup-restore.md`](backup-restore.md) is the full story, including restoring and why the JSON export is **not** a backup.

The cold copy is the one to automate. In root's crontab:

```cron
15 3 * * * cd /srv/inventory && docker compose stop && cp -a data backups/data-$(date +\%F) && docker compose start
30 3 * * * find /srv/inventory/backups -maxdepth 1 -name 'data-*' -mtime +30 -exec rm -rf {} +
```

`mkdir -p /srv/inventory/backups` first, and note the `\%` — cron reads a bare `%` as a newline and would hand `date` nothing.

That is a few seconds of downtime at 03:15, in exchange for a copy that is certainly consistent: a stopped container has flushed the WAL. For no downtime at all, `docs/backup-restore.md` has the hot `.backup` variant, which takes a proper snapshot of a live database from a throwaway container on the same volume.

Then get the copies off the machine — rsync, a bucket, anything. A backup on the same disk survives a mistake, not a dead disk. And restore one once, early, so you know the procedure works before you need it.

## Upgrades

```bash
cd /srv/inventory
docker compose pull
docker compose up -d
```

That is the whole procedure. **Migrations run at every boot and are idempotent**, so there is no separate step, no maintenance mode and nothing to remember.

- **Back up first** if the nightly copy is hours old. Migrations are forward-only — there is no down step — so going back to an older image after one has run means restoring the directory, not pulling the previous tag.
- **Pin the tag if you want to choose your moment.** A release publishes `:0.2.0`, `:0.2` and `:latest`, for amd64 and arm64; `image: …:0.2.0` in the compose file makes `pull` a decision instead of a surprise.
- **Watch it come up**: `docker compose logs -f inventory`. Migration and boot lines land there.
- `docker image prune` afterwards, when the old images stop being interesting.

## Health

```bash
curl -fsS https://inventory.example.com/api/v1/healthz    # → {"ok":true}
```

`/api/v1/healthz` runs a query against the database before it answers, so it speaks for the process **and** its file. It says nothing about the proxy, the certificate or the disk — check those where they live.

The image carries its own healthcheck, so this works with no monitoring at all: every 30 seconds, 5-second timeout, 10-second grace at start, three strikes, hitting `127.0.0.1:3000/api/v1/healthz` with node's own `fetch` (there is no curl in the image and no reason to add one).

```bash
docker compose ps                                                       # the health column
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q inventory)"
```

Docker will not restart an unhealthy container on its own — `restart: unless-stopped` acts on a process that exited, not on a failing probe. A watchdog is your monitoring's job.

`GET /api/v1/meta` is public and says the version and whether setup has run, which is the cheap thing to curl after an upgrade. Logs are pino JSON on stdout in production (`docker compose logs -f inventory`), and they hold no secrets: the one route with a raw token in its path is redacted before a line is written.

## Moving up

When one machine stops being the answer — more people than a single process should serve, attachments outgrowing the volume, or a compliance line that wants the database managed — the full-scale AWS build lives in `infrastructure/`: flat Terraform for a VPC, an EC2 instance running this same image, RDS PostgreSQL and a private S3 bucket for attachments. Its README carries the variables, the running cost and the teardown.

Moving an existing workspace across is an export and an import, not a migration: **there is no automated SQLite→PostgreSQL data path before 1.0.** Admin → Settings → **Export all data** reads the whole workspace out as JSON, and the CSV import writes people and assets into a fresh instance — employees first, because asset rows reference their holder's email. Ownership history, attachment bytes and passwords do not travel that way; the export deliberately holds no hashes, so members are re-invited on the new instance. If that is more than you are willing to lose, stay on production light until the path exists. This is a pre-1.0 product, and that is the honest state of it.

## When it does not work

**Every save 403s in the browser, but curl works.** `APP_URL` is wrong. The origin guard compares the browser's `Origin` against `APP_URL`'s origin exactly; curl sends no `Origin` at all, so it sails past the same check. The 403 names the origin this instance expects — compare it with the address bar, character for character.

**Ten bad logins locked everybody out.** `TRUST_PROXY` is unset behind a proxy, so every request shares the proxy's address and its bucket. Set it to `1` — one proxy in front — and restart.

**The container prints "The data directory … is not writable" and stops.** The mounted directory is not writable by uid 1000. `chown -R 1000:1000 /srv/inventory/data`, or take the one-run root heal the message itself prints.

**502 from the proxy.** Nothing is listening where the proxy looks. `docker compose ps` for the state, then `curl -sS http://127.0.0.1:3000/api/v1/healthz` from the host — if that answers, the proxy has the wrong address; if it does not, `docker compose logs inventory` has the reason.

**No certificate.** Port 80 is closed, or the A record points at a different host. Both proxies here validate over HTTP-01, which is an inbound connection on port 80 for exactly that name.

**Uploads over a megabyte or two fail, and the app never sees them.** nginx's `client_max_body_size` — its default is 1 MB, and the block above raises it to 12. Caddy has no such default.
