import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root, two levels up from server/src (or server/dist in a build). */
export const repoRoot = resolve(here, "..", "..");

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

export const config = {
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT ?? 5174),
  appOrigin: required("APP_ORIGIN", "http://localhost:5173"),
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
