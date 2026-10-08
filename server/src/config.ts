import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Finds the repository root by walking up to the package.json that declares the
 * workspaces.
 *
 * Counting directory levels does not work: running from source the entry point
 * is `server/src`, but a build puts it at `server/dist/server/src` because the
 * compiler emits the shared workspace alongside it. A fixed "../.." was right
 * in development and silently wrong in production, where it made the server
 * look for the browser bundle inside its own dist directory.
 */
function findRepoRoot(from: string): string {
  let dir = from;
  for (let depth = 0; depth < 10; depth++) {
    const manifest = resolve(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { workspaces?: unknown };
        if (Array.isArray(parsed.workspaces)) {
          return dir;
        }
      } catch {
        // An unreadable package.json is not the root; keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `Could not locate the Chronoplot root from ${from}. Set CHRONOPLOT_ROOT to the directory containing the workspace package.json.`,
  );
}

export const repoRoot = process.env.CHRONOPLOT_ROOT
  ? resolve(process.env.CHRONOPLOT_ROOT)
  : findRepoRoot(here);

loadDotenv({ path: resolve(repoRoot, ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}. Copy env.example to .env.`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

const driver = required("DB_DRIVER", "sqlite");
if (driver !== "sqlite" && driver !== "postgres") {
  throw new Error(`DB_DRIVER must be "sqlite" or "postgres", got "${driver}".`);
}

const sessionSecret = required(
  "SESSION_SECRET",
  isProduction ? undefined : "development-only-insecure-session-secret-value",
);

// A short secret in production means forgeable CSRF tokens, so refuse to boot
// rather than run in a state that looks fine but isn't.
if (isProduction && sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters in production.");
}

const appOrigin = required("APP_ORIGIN", "http://localhost:5173");

/*
 * Whether the auth cookies carry the Secure flag.
 *
 * Tied to the scheme APP_ORIGIN names, not to NODE_ENV - which is what this
 * used to be, and it cost a day. A browser refuses to *store* a Secure cookie
 * that arrived over plain HTTP, with localhost the one exception every browser
 * makes. So a production instance reached at http://<lan-address> looked like
 * it worked: the login returned 200 and the user, the browser silently dropped
 * both cookies, and every request after that was unauthenticated again. The
 * symptom appeared nowhere near the cause, and it could not reproduce on
 * localhost.
 *
 * Serving over plain HTTP is a legitimate choice for a self-hosted instance on
 * a trusted network, so this is a fact about the deployment, not a thing to
 * infer from the build mode.
 */
const cookiesSecure = appOrigin.startsWith("https://");

export const config = {
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT ?? 5174),
  appOrigin,
  cookiesSecure,
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? "true") !== "false",
  sessionSecret,
  db: {
    driver: driver as "sqlite" | "postgres",
    /** For sqlite a file path (relative paths resolve from the repo root). */
    url: required("DATABASE_URL", "./data/chronoplot.sqlite"),
  },
  /** How long a login lasts. Refreshed on use, so active users stay signed in. */
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,
} as const;
