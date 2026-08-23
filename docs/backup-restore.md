# Backup and restore

Everything this app keeps lives in one directory — `DATA_DIR`, which is `/data` in the container and the volume you mounted there:

```
/data
  inventory.db        the whole database
  inventory.db-wal    writes not yet folded into the main file
  inventory.db-shm    shared-memory index for the WAL
  uploads/            attachment files, named by id
```

Back up that directory and you have backed up the product. There is nothing else — no external cache, no queue, no secret at rest.

That is the default instance, and everything up to [Restore](#restore) describes it. An instance with `DATABASE_URL` or `S3_BUCKET` set has moved part of its state out of the directory, and backs it up somewhere else — [PostgreSQL and S3](#postgresql-and-s3).

## Cold backup: stop, copy, start

The simplest correct thing, and the one to use if you are unsure:

```bash
docker compose stop
cp -a ./data ./backups/data-$(date +%F)
docker compose start
```

A stopped container has flushed the WAL, so the copy is a consistent database.

## Hot backup: `.backup`, without stopping

`cp inventory.db` on a **running** instance is the classic way to get a corrupt backup: the file is missing whatever is still in the WAL, and it may be caught mid-write. SQLite has a command for doing it properly — `.backup` takes a consistent snapshot of a live database, WAL included.

The inventory image ships no `sqlite3` binary (it is Debian-based and carries only what the app needs), so run it from a throwaway container attached to the same volume:

```bash
docker run --rm -v inventory_data:/data alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && sqlite3 /data/inventory.db ".backup /data/backup.db"'
```

Substitute your volume name — `docker volume ls` if you are not sure, or the host path if you bind-mounted `./data` as the compose file does.

Then copy `backup.db` and `uploads/` wherever backups go.

**Copy `uploads/` too.** The database records that an attachment exists; the bytes are in the directory.

## Restore

Restoring is putting the directory back:

```bash
docker compose down
rm -rf ./data
cp -a ./backups/data-2026-08-17 ./data
docker compose up -d
```

`cp -a` keeps whatever ownership it finds, and the container is unprivileged (uid 1000) and cannot take the directory over — so if the restored `./data` came back owned by somebody else, `sudo chown -R 1000:1000 ./data` before starting. A container that finds it unwritable says so and stops rather than starting half-broken.

If you restored from a `.backup` snapshot, the file is called `backup.db` — rename it to `inventory.db` and delete any `-wal` and `-shm` files beside it; they belong to the database they were taken from.

A restored database from an older release is fine: migrations run at boot and bring it forward.

## PostgreSQL and S3

`DATABASE_URL` moves the rows to a PostgreSQL server; `S3_BUCKET` moves the attachments to a bucket. Set either and the directory stops being the whole story — with both set it holds nothing worth copying, and the state lives in two places that each know how to back themselves up.

**The rows become the database server's problem, and it is better at this than `cp` is.** On RDS that means automated backups — seven days of them in [`infrastructure/`](../infrastructure/README.md), taken in the maintenance window, with point-in-time recovery anywhere inside it, and storage up to the size of the database costs nothing. Take a manual snapshot before anything you would want to undo: automated ones expire on their own, manual ones wait for you. On a PostgreSQL server you run yourself, `pg_dump --format=custom` is the equivalent worth keeping, because `pg_restore` can be selective about that format and cannot be about a plain SQL file.

**The attachments become the bucket's.** The Terraform bucket is versioned, so an overwritten or deleted object is recoverable until its old versions are expired — and nothing expires them for you. Versioning is not off-site, though: it survives a mistake, not a deleted bucket or a lost account. Replication to a second bucket, or a scheduled `aws s3 sync` to somewhere else, is what turns it into a backup.

**Nothing snapshots the two together, and that is the part to plan for.** A restore that puts the database back to Tuesday while the bucket is still at Friday leaves rows pointing at objects that do not exist, and objects nothing points at. The app cleans up the second kind on its own — the nightly sweep removes stored files no attachment row names, once they are a day old — but the first kind is a download that 404s, and whether that matters is your call. If it does, take a manual RDS snapshot and record the bucket's state at the same moment, and restore them as a pair.

[`infrastructure/README.md`](../infrastructure/README.md#backups) has the AWS specifics. Moving an existing workspace from SQLite to PostgreSQL is not a restore and not a migration — there is no automated path before 1.0; [Moving up](deployment.md#moving-up) says what the export-and-import route costs.

## The JSON export is not a backup

Admin → Settings → **Export all data** produces a JSON file of assets, people, ownership history, custom fields, members and settings. It is a **reporting format** — for a spreadsheet, an audit, or moving data somewhere else.

It deliberately contains no password hashes, no sessions or tokens, and no attachment bytes. Nothing could sign in from it, and nothing can restore an instance from it. The UI says so next to the button.

## What to test, once

A backup nobody has restored is a hope. After the first one:

1. `docker compose down`
2. Move `./data` aside rather than deleting it.
3. Restore the backup and start.
4. Sign in, open an asset, download one of its attachments.

Then you know.

## Notes

- **Single replica.** The nightly jobs run in-process and SQLite is one file; two containers on one volume would both fire. This matters for backups too: one writer means one consistent thing to copy.
- **Snapshot the volume if your host can.** A filesystem or block-level snapshot of a stopped container is equivalent to the cold copy and usually faster.
- The database is small. A workspace with 10,000 assets and their full history is a few tens of megabytes; the attachments are what take space.
