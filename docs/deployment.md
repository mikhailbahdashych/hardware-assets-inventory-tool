# Deploying it

Production light: **one container, one volume, and a reverse proxy you put in front of it.** A small VM is enough — a single Node process over a SQLite file, where only the attachments grow on their own. The image ships no proxy and terminates no TLS, on purpose: certificates, redirects and HTTP/2 are your edge's job, and this guide is the contract between it and the container.

**Single replica, always.** The scheduled jobs run in-process, so two containers would both fire them — on either engine. Scale the machine, not the count.

## DNS

One A record, pointing at the host's public address:

```
inventory.example.com.   A   203.0.113.10
```

An AAAA record too if the host has IPv6. Do it **first**: both proxies below get their certificate over an HTTP-01 challenge, which is a certificate authority resolving that name and connecting to it on port 80. The record has to be right before the proxy first starts: a name that does not resolve to this host is a refused issuance, and repeated failures are themselves rate-limited by the authority.

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
      TRUST_PROXY: 'loopback,uniquelocal'
      # The nightly jobs run on wall-clock time, so this decides when 08:00 is.
      TZ: Europe/Berlin
```

```bash
docker compose up -d
```

`TZ` decides when the jobs fire — maintenance at 03:00, the warranty and return notices at 08:00 — but the jobs work out what "today" is in UTC. That only matters for a zone more than eight hours ahead of UTC: there, 08:00 local is still yesterday in UTC, and a notice is reckoned a day late.

The file you downloaded also carries `build: .`, so from a checkout of the repo `docker compose up -d --build` deploys the image that checkout builds — the same deployment, from your own bytes. It tags that build with the `image:` name, so `docker images` then shows your build as `…:latest`; `GET /api/v1/meta` reports the version the running code says it is.

**Finish `/setup` before you hand the address to anybody.** A fresh instance is empty and its first screen creates the organization and its first admin — it answers 409 to everyone afterwards, so whoever reaches it first is the admin. That is a ten-second window you should close yourself.

## The reverse-proxy contract

Four rules, and the app asks for nothing else.

**1. Forward everything to port 3000.** One process serves both halves — the REST API under `/api/v1` and the SPA that calls it come out of the same port, so there is nothing to split and no static host to configure. No websockets, no long-poll, no streaming endpoints.

**2. Pass `Host` through, and the client's address in `X-Forwarded-For`.** nginx replaces `Host` with the upstream it is proxying to unless told otherwise; Caddy keeps the original. Nothing in the app decides anything from `Host` — the origin guard compares against `APP_URL` and nothing else, deliberately, because `Host` is whatever the caller typed — so passing it is hygiene rather than a requirement, and it costs one line. `X-Forwarded-For` is the one that matters, and rule 4 is why.

**3. `APP_URL` is exactly the address a browser uses.** Scheme, host, and the port if it is not the default — `https://inventory.example.com`, with no trailing path. Two things hang off it, and both fail in ways that look like something else:

- **The origin guard.** Every mutating request is checked: the browser's `Origin` (or `Referer`) must parse to the same origin as `APP_URL`, exactly, or it is a 403. That is the CSRF stance here — same-origin only, no tokens — and because it compares against that one value and nothing else, a wrong `APP_URL` is not a warning you can live with, it is an app where nothing saves. `/setup` included: get it wrong and the very first screen refuses. The 403 names the origin the instance expects, which is the fastest way to see what you typed. `www.` counts. The port counts. `http` versus `https` counts.
- **Secure cookies.** An `https://` value marks the session cookie `Secure` on its own; nothing else has to be set. `COOKIE_SECURE` overrides that, and exists for the deployment whose public scheme `APP_URL` does not describe.

The default, `http://localhost:3000`, is right for a laptop only; a production instance still carrying it prints a boot warning naming this variable.

**4. `TRUST_PROXY` names the proxy — and is never set without one.** It decides what the app believes the client's address is, and the rate limits are keyed on that: ten **failed** sign-ins per 15 minutes per address (the password step and the two-factor code each keep their own count; a sign-in that succeeds costs nothing), and ten uses an hour per address of invitation and reset links. Changing your own password is limited as well, ten tries an hour, but per member rather than per address.

Behind a proxy without it, every request arrives as the proxy's own address and shares one bucket — ten bad passwords from one stranger lock the whole workspace out for fifteen minutes. Set with nothing in front, it is worse: `X-Forwarded-For` is then a header any client writes, so an attacker takes a fresh address per attempt and the limits stop existing. It is also what fills the `ip` field of every log line.

**Name the proxy — an address, not `true`.** `true` trusts every `X-Forwarded-For` entry and reads the left-most as the client, which is only correct for a proxy that _replaces_ the header; the nginx block below appends, so under `true` a caller writes their own address and gets a fresh bucket per request. `loopback,uniquelocal` covers a proxy on the same host — safe precisely because the port mapping above binds `127.0.0.1`; the two lines are a pair. A fixed address (`203.0.113.7`) or a subnet (`10.0.0.0/16`) is more precise still. **A hop count (`1`, `2`) is refused at boot**: fastify disabled the numeric form (GHSA-3m5p-2c4r-xxw2) because a count cannot verify who connected.

## The proxy itself

Both of these are complete. Pick one.

### Caddy

`/etc/caddy/Caddyfile`:

```caddy
inventory.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

That is the whole file: Caddy obtains and renews the certificate, redirects to `https://`, keeps `Host` and sets `X-Forwarded-For` — the entire contract above, by default — and has no body limit to trip a 10 MB attachment. An `email you@example.com` global block gets you expiry warnings; issuance works without one.

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

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

`X-Forwarded-Proto` is convention, not necessity — the app takes its scheme from `APP_URL`. Neither block sends `Strict-Transport-Security`, and neither does the app. HSTS is a promise about your whole domain, including every other name under it, so it belongs to whoever owns the domain rather than to this guide.

## Firewall

Inbound: your administrative port, 80 and 443. Nothing else.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable
```

**Port 80 stays open** even though everything on it redirects: it is where the renewal challenge lands. **Port 3000 must not be reachable from outside**, and the port mapping is what settles that, not the firewall. Docker publishes a port by writing DNAT rules that are consulted before ufw's rules are, so `ufw deny 3000` on a port published to `0.0.0.0` is a rule nobody reads. Binding the mapping to `127.0.0.1:3000:3000` is the fix, because there is then nothing on the public interface to filter.

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

`mkdir -p /srv/inventory/backups` first, and keep the `\%` — cron reads a bare `%` as a newline. A few seconds of downtime buys a copy that is certainly consistent (a stopped container has flushed the WAL); [`backup-restore.md`](backup-restore.md) has the hot `.backup` variant for none. Then get the copies off the machine — rsync, a bucket, anything. A backup on the same disk survives a mistake, not a dead disk. And restore one once, early, so you know the procedure works before you need it.

## Upgrades

```bash
cd /srv/inventory
docker compose pull
docker compose up -d
```

That is the whole procedure: **migrations run at every boot and are idempotent**, with no separate step and no maintenance mode. This section is the one place the upgrade path is written down; the README, the infrastructure README and the development guide link here.

**From v0.1.0 or v0.2.0, too.** v0.3.0 collapsed the migration history into one `0000_init` per engine; the migrator recognises the older history, finishes it with the pre-squash migrations shipped beside the new ones, records `0000_init` as applied and carries on. A history it does not recognise — a build that is neither a release nor this version — stops the boot **before changing anything**, with a sentence beginning `This database's migration history has N entries this version does not recognise` that ends by saying how to move the data out.

- **Read the [release notes](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/releases)** for every version you are crossing. A breaking change — an environment variable that means something new, a feature that went away — is written there and nowhere else.
- **Back up first** if the nightly copy is hours old. Migrations are forward-only — there is no down step — so going back to an older image after one has run means restoring the directory, not pulling the previous tag.
- **Pin the tag if you want to choose your moment.** A release publishes `:X.Y.Z`, `:X.Y` and `:latest`, for amd64 and arm64; `image: …:0.3.0` in the compose file makes `pull` a decision instead of a surprise. Take `X.Y.Z` from the newest `vX.Y.Z` on the repository's [packages page](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pkgs/container/hardware-assets-inventory-tool) — a pinned tag older than what runs is a downgrade, and migrations do not run backwards.
- **Watch it come up**: `docker compose logs -f inventory`. The first JSON line of every boot is `"msg":"database and storage engaged"`, naming the `engine`, the `database`, the `storage` and `migrationsApplied` — how many migrations this boot ran, which is the line that says the upgrade did something.
- `docker image prune` afterwards, when the old images stop being interesting.

## Health

```bash
curl -fsS https://inventory.example.com/api/v1/healthz    # → {"ok":true}
```

`/api/v1/healthz` runs a query before it answers, so it speaks for the process **and** its database — not for the proxy, the certificate or the disk. The image carries its own healthcheck: every 30 seconds, 5-second timeout, 10-second grace at start, three strikes, hitting `127.0.0.1:3000/api/v1/healthz` with node's own `fetch` (there is no curl in the image and no reason to add one).

```bash
docker compose ps                                                       # the health column
docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q inventory)"
```

Docker will not restart an unhealthy container — `restart: unless-stopped` acts on an exit, not a failing probe; a watchdog is your monitoring's job. `GET /api/v1/meta` is public and says the version and whether setup has run, which is the cheap thing to curl after an upgrade. Logs are pino JSON on stdout in production (`docker compose logs -f inventory`), and they hold no secrets: the one route with a raw token in its path is redacted before a line is written.

## Moving up

When one machine stops being the answer, [`infrastructure/`](../infrastructure/README.md) is flat Terraform for AWS: an EC2 instance running this same image, RDS PostgreSQL and a private S3 bucket. Its README carries the variables, the cost and the teardown.

**There is no automated SQLite → PostgreSQL data path before 1.0.** Moving a workspace across is an export and an import: **Export all data** reads it out as JSON, and the CSV import writes people, then assets, into the new instance. Ownership history, attachment bytes and passwords do not travel that way (members are re-invited). If that is more than you can lose, stay on production light until the path exists.

## When it does not work

**Every save 403s in the browser, but curl works.** `APP_URL` is wrong. The origin guard compares the browser's `Origin` against `APP_URL`'s origin exactly; curl sends no `Origin` at all, so it sails past the same check. The 403 names the origin this instance expects — compare it with the address bar, character for character.

**Ten bad logins locked everybody out.** `TRUST_PROXY` is unset behind a proxy, so every request shares the proxy's address and its bucket. Name the proxy — `loopback,uniquelocal` for one on the same host — and restart. (It refuses to boot on a hop count like `1`, the pre-0.2 form: name an address instead.)

**The container prints "The data directory … is not writable" and exits — again and again under `restart: unless-stopped`.** The mounted directory is not writable by uid 1000. `chown -R 1000:1000 /srv/inventory/data`, or heal it in one run as root: `docker compose run --rm --user root inventory node -e ''` takes ownership and drops back to uid 1000, and normal starts work after it.

**502 from the proxy.** Nothing is listening where the proxy looks. `docker compose ps` for the state, then `curl -sS http://127.0.0.1:3000/api/v1/healthz` from the host — if that answers, the proxy has the wrong address; if it does not, `docker compose logs inventory` has the reason.

**No certificate.** Port 80 is closed, or the A record points at a different host. Both proxies here validate over HTTP-01, which is an inbound connection on port 80 for exactly that name.

**Uploads over a megabyte or two fail, and the app never sees them.** nginx's `client_max_body_size` — its default is 1 MB, and the block above raises it to 12. Caddy has no such default.
