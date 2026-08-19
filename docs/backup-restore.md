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
