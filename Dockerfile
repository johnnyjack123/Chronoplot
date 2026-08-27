# syntax=docker/dockerfile:1
#
# Chronoplot - single image serving both the API and the browser app.
#
# Serving both from one origin is not incidental: it is what lets the session
# cookie stay SameSite=Lax with no CORS exceptions. Splitting them across hosts
# means revisiting the cookie settings in server/src/auth/plugin.ts.

# ---------------------------------------------------------------- build ----
# Debian rather than Alpine: better-sqlite3 and @node-rs/argon2 both ship
# prebuilt binaries for glibc, so the image builds without compiling anything.
# The toolchain is installed anyway as a fallback for architectures with no
# prebuild - it costs nothing in the final image, which is a separate stage.
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Manifests first, so a source-only change does not re-run the install layer.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci

COPY . .

RUN npm run build \
 && npm prune --omit=dev

# -------------------------------------------------------------- runtime ----
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5174 \
    DB_DRIVER=sqlite \
    DATABASE_URL=/data/chronoplot.sqlite

WORKDIR /app

# tini reaps zombies and forwards signals, so the server's SIGTERM handler
# actually runs and closes the database cleanly on `docker stop`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

# The database lives on a volume, never inside the image layer.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 5174

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5174)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/server/src/index.js"]
