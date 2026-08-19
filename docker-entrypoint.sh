#!/bin/sh
set -e

# The image runs as node (`USER` in the Dockerfile), so `docker exec` lands as
# node too. The cost: nothing in the default path may chown a bind-mounted
# /data that arrives owned by somebody else — so this probes and explains
# instead of failing on the first mkdir with a bare EACCES.
#
# Started explicitly with --user root, the old behavior is the escape hatch:
# take ownership, drop to node, run. One such run heals a mount in place.

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = '0' ]; then
  mkdir -p "$DATA_DIR"
  # Only walk the tree when the owner is actually wrong: on a normal restart
  # this is one stat, not a recursive chown over every uploaded attachment.
  if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
    chown -R node:node "$DATA_DIR"
  fi
  # setpriv is util-linux, already in the base image — no gosu to install.
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

# The default path. The directory may already exist (a bind mount always does),
# so a failed mkdir is not yet an answer — the probe below is.
mkdir -p "$DATA_DIR" 2>/dev/null || true
if ! touch "$DATA_DIR/.writable-probe" 2>/dev/null; then
  echo "The data directory ($DATA_DIR) is not writable by uid $(id -u)." >&2
  echo "On the host, either:  chown -R 1000:1000 ./data" >&2
  echo "or run the container once as root to let it fix itself:" >&2
  echo "  docker compose run --rm --user root inventory node -e ''" >&2
  exit 1
fi
rm -f "$DATA_DIR/.writable-probe"

exec "$@"
