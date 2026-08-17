#!/bin/sh
set -e

# A bind-mounted /data arrives with the *host* directory's ownership, which is
# almost never uid 1000 — so a container that simply ran as `node` would fail
# its first mkdir with EACCES, on the very first start, following the README's
# own quick start. Fixing that is what this script exists for.
#
# It starts as root, takes ownership of the data directory, and drops to `node`
# before exec'ing the app. Nothing after this line runs privileged.

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

# Started with an explicit --user, or under a rootless daemon: there are no
# privileges to drop and nothing we are allowed to chown. If the directory is
# not writable, the app says so plainly rather than dying on a stack trace.
exec "$@"
