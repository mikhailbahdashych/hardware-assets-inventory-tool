# One container: the API serving its own built SPA, with SQLite on /data.
#
# bookworm-slim rather than alpine because better-sqlite3 and @node-rs/argon2
# ship glibc prebuilds — on musl they compile from source, which turns a
# 40-second build into several minutes and needs a toolchain in the image.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Only the manifests, so this layer survives every change that is not a
# dependency change.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
# --ignore-scripts: better-sqlite3 and @node-rs/argon2 both ship their compiled
# binaries inside the package, so npm's automatic `node-gyp rebuild` would
# recompile what is already there — and would need Python and a C++ toolchain
# in the image to do it. esbuild resolves its platform binary the same way.
RUN npm ci --ignore-scripts


FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only. The API is bundled by tsup with `shared` inlined,
# so what is left here is the native modules and Fastify's runtime.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN npm ci --omit=dev --ignore-scripts --workspace apps/api --include-workspace-root \
    && npm cache clean --force

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

# The one directory to back up: the SQLite file and the uploaded attachments.
ENV DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist \
    PORT=3000 \
    HOST=0.0.0.0
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
EXPOSE 3000

# `USER node`, so the app runs unprivileged and so does every `docker exec`
# into the container — a shell that lands as root is a root shell someone will
# eventually paste something into. The cost: a bind-mounted /data arrives with
# the host directory's ownership, and nothing in this path is allowed to chown
# it. That is why the entrypoint probes the directory and prints the two fixes
# rather than dying on an EACCES nobody can read.
#
# `--user root` is the explicit escape hatch, and the entrypoint's root branch
# is what it buys: take ownership, drop back to node, run. One such run heals
# a mount in place.
USER node
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

# No curl or wget in a slim image, and no reason to add one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/api/dist/index.js"]
