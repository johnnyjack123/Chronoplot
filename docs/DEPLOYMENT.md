# Deployment

Running Chronoplot somewhere other than a development machine: configuration,
Docker, the database, backups, and CI.

---

## Configuration

Everything comes from environment variables, read from `.env` in the repo root.
Copy `env.example` and edit it:

```bash
cp env.example .env
```

| Variable | Meaning |
|---|---|
| `PORT` | Port the API listens on (default 5174) |
| `NODE_ENV` | `production` enables the `Secure` cookie flag and stricter checks |
| `DB_DRIVER` | `sqlite` or `postgres` |
| `DATABASE_URL` | A file path for SQLite, a connection string for Postgres |
| `SESSION_SECRET` | Signs CSRF tokens. At least 32 characters, or the server refuses to start in production |
| `APP_ORIGIN` | Where the browser reaches this instance. Must match exactly, including scheme and port |
| `ALLOW_REGISTRATION` | Only the *initial* value; after first boot the admin screen owns this setting |

In production the server serves the built browser app from its own origin. That
is what lets the session cookie stay `SameSite=Lax` with no CORS exceptions — do
not split the two across hosts without revisiting the cookie settings in
`server/src/auth/plugin.ts`.

---

## Docker

```bash
docker build -t chronoplot:latest .   # produce the image
cp env.example .env                   # set SESSION_SECRET to something random
docker compose up -d                  # run it
```

Or pull a published image instead of building:

```bash
docker pull ghcr.io/johnnyjack123/chronoplot:latest
```

Building and running are separate: `docker-compose.yml` only describes how to
*run* an image, so the same image can be built once, pushed to a registry, and
run anywhere. The tag has to match the `image:` line in that file.

**Nothing secret is in the image.** `.env` is excluded from the build context,
so it cannot be copied in even by accident, and the Dockerfile sets no secret of
its own. Put `SESSION_SECRET` in `.env` rather than passing it on the command
line: it signs the CSRF tokens, so a fresh random value on every start would
reject every already-open browser tab with a 403 until it reloaded.

`DATABASE_URL` is the one value compose sets itself rather than reading from
`.env`, because inside the container it has to point at the volume. The database
lives on `chronoplot-data`, never in an image layer — losing that volume loses
every project.

Building under WSL works from either filesystem, though a clone on the Linux
side is much faster than one reached through `/mnt/c`. `.gitattributes` keeps
the Dockerfile on LF endings so a Windows checkout does not upset the parser.

---

## Postgres instead of SQLite

Change two lines in `.env` — no code changes, no migration tool:

```
DB_DRIVER=postgres
DATABASE_URL=postgres://user:password@localhost:5432/chronoplot
```

The schema is created on boot. Everything that differs between the two databases
is contained in `server/src/db/adapter.ts`; queries elsewhere are written once in
portable SQL.

---

## Backups

```bash
node scripts/backup-db.mjs
```

Writes a timestamped, self-contained copy into `backups/` and verifies it by
reopening it and comparing row counts. Use this rather than copying the
`.sqlite` file: WAL journalling keeps recent commits in a separate `-wal` file,
so a plain copy can be almost empty. Safe to run while the server is up.

From a container, and then off the volume:

```bash
docker compose exec chronoplot node scripts/backup-db.mjs /data/chronoplot.sqlite
docker compose cp chronoplot:/data/backups ./backups
```

### Rehearsing a migration

Schema migrations run on boot, which is convenient and also the reason to
rehearse one before it meets real data:

```bash
node scripts/check-migration.mjs copy      # copy the live database
DATABASE_URL=backups/migration-rehearsal.sqlite PORT=5189 npm start
node scripts/check-migration.mjs verify    # nothing lost, columns added
```

---

## Continuous integration

`.github/workflows/ci.yml` typechecks, runs all six unit suites and the HTTP
smoke test against a production build, then builds and publishes a multi-arch
image. The image jobs depend on the test job, so a push that breaks the suite
never produces a tagged image.

Each architecture is built on a machine of that architecture — `ubuntu-latest`
for amd64, `ubuntu-24.04-arm` for arm64 — and pushed **by digest**. A final job
stitches the digests into one tagged manifest list with
`docker buildx imagetools create`. Pushing by digest matters: two jobs pushing
the same tag would each overwrite the other's architecture.

No secret to configure: `GITHUB_TOKEN` can write to GHCR given the
`packages: write` permission each job declares. One repository setting does need
checking — **Settings → Actions → General → Workflow permissions** must be
"Read and write", or the push to the registry is refused.

The image name is derived from the repository and lowercased, because GHCR
rejects uppercase names and a repository is free to have one.

### Tags

Every push to the default branch publishes three tags, all pointing at the same
image:

| Tag | Meaning |
|---|---|
| `latest` | A moving pointer to the newest build of the default branch |
| `main` | The same, named after the branch |
| `sha-<short>` | Pinned to one commit. This never moves |

A `v1.2.3` git tag additionally publishes `1.2.3` and `1.2`. For a deployment
that must not change underneath you, pin to `sha-…` or a version rather than
`latest`.

Docker resolves any of them to whichever architecture is doing the pulling;
there is no separate arm64 tag to remember.

### Linking the package to the repository

The workflow labels each image with `org.opencontainers.image.source`, which is
what makes GitHub attach the package to this repository instead of leaving it
floating under the account. The label has to be on the per-architecture images —
a manifest list carries none of its own.

### If a dependency ever has to be compiled for arm64

Today nothing is: `better-sqlite3` and `@node-rs/argon2` both ship arm64
prebuilds, so the build only ever downloads binaries. If that changes, note that
emulated *compilation* is a different order of problem from emulated scripting —
a native addon that takes a minute on x86 can take twenty under QEMU, and
`node-gyp` builds have been known to exhaust the runner. The native-runner
matrix this workflow already uses is the answer; do not fall back to a single
QEMU job at that point.

For reference, the QEMU fallback (correct, just slow) is a single job with:

```yaml
- uses: docker/setup-qemu-action@v3
  with: { platforms: arm64 }
- uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ${{ steps.meta.outputs.tags }}
```

That is what to use if the repository becomes private, since
`ubuntu-24.04-arm` runners are only free for public ones.
