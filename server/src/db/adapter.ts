/*
 * The whole SQLite <-> Postgres switch lives in this file.
 *
 * Queries elsewhere in the server are written once, in portable SQL with `?`
 * placeholders. The Postgres adapter rewrites those to `$1, $2, ...`; nothing
 * else in the codebase knows which database it is talking to.
 *
 * Portability rules the rest of the server follows, so this stays true:
 *   - ids are application-generated UUID strings, never AUTOINCREMENT/SERIAL
 *   - timestamps are epoch milliseconds in an integer column
 *   - booleans are 0/1 integers
 *   - JSON documents are stored as TEXT and parsed in application code
 *   - no RETURNING; do an explicit SELECT after a write
 */

export interface Db {
  /** Rows from a SELECT. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** First row of a SELECT, or undefined. */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** INSERT / UPDATE / DELETE / DDL. */
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: "sqlite" | "postgres";
}

/** Rewrites portable `?` placeholders into Postgres `$1, $2, ...` form. */
export function toPositional(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/* -------------------------------------------------------------- SQLite -- */

/**
 * Turns a failure to open the database into something actionable.
 *
 * SQLite reports every one of these as `SQLITE_CANTOPEN`, which says nothing
 * about which of several very different causes applied. In a container it is
 * almost always the directory's ownership - the process runs as `node`, and a
 * volume created before the image existed belongs to root - and that is not
 * something anyone should have to deduce from an eight-line stack trace.
 *
 * Returns the error rather than throwing it, so the caller's `throw` keeps the
 * control flow obvious to the compiler and the reader alike.
 */
async function describeOpenFailure(file: string, cause: unknown): Promise<Error> {
  const { accessSync, existsSync, statSync, constants } = await import("node:fs");
  const { dirname } = await import("node:path");

  const directory = dirname(file);
  const lines = [`Cannot open the SQLite database at ${file}.`, ""];

  if (!existsSync(directory)) {
    lines.push(`The directory ${directory} does not exist and could not be created.`);
  } else {
    let writable = true;
    try {
      accessSync(directory, constants.W_OK);
    } catch {
      writable = false;
    }

    lines.push(`Directory : ${directory}`);
    if (process.getuid) {
      const stats = statSync(directory);
      lines.push(`Owned by  : uid ${stats.uid}, gid ${stats.gid}`);
      lines.push(`Running as: uid ${process.getuid()}, gid ${process.getgid?.() ?? "?"}`);
    }
    lines.push(`Writable  : ${writable ? "yes" : "NO"}`);

    if (!writable) {
      lines.push(
        "",
        "The directory is not writable by this process. In Docker this usually",
        "means the volume was created before the image set its ownership, or a",
        "bind mount points at a host directory owned by someone else.",
        "",
        "Compose prefixes volume names with the project, so find the real name",
        "first rather than guessing - naming a volume that does not exist just",
        "creates a new empty one:",
        "",
        "  docker volume ls | grep chronoplot",
        "  docker compose down",
        "  docker run --rm -v <the-name>:/data alpine chown -R 1000:1000 /data",
        "  docker compose up -d",
      );
    } else if (existsSync(file)) {
      lines.push("", `The directory is writable, so check ${file} itself - it may be`);
      lines.push("owned by another user, or not a database file at all.");
    }
  }

  lines.push("", `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`);
  return new Error(lines.join("\n"));
}

export async function createSqliteDb(file: string): Promise<Db> {
  const { default: Database } = await import("better-sqlite3");
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");

  // A no-op when the directory already exists, including when it exists and is
  // unwritable - which is exactly the case the open below then fails on.
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    // Reported properly by explainOpenFailure once the open fails.
  }

  let sqlite: import("better-sqlite3").Database;
  try {
    sqlite = new Database(file);
  } catch (cause) {
    // Thrown here rather than inside the helper so the compiler can see that
    // this branch never falls through to the assignment below.
    throw await describeOpenFailure(file, cause);
  }

  // WAL keeps readers from blocking the sync writes the editor sends.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const wrap = (): Db => ({
    driver: "sqlite",
    async all<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).all(...(params as never[])) as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).get(...(params as never[])) as T | undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      sqlite.prepare(sql).run(...(params as never[]));
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      // better-sqlite3's own transaction() helper is synchronous, so drive the
      // transaction manually to keep the async signature.
      sqlite.exec("BEGIN");
      try {
        const result = await fn(wrap());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {
      sqlite.close();
    },
  });

  return wrap();
}

/* ------------------------------------------------------------ Postgres -- */

export async function createPostgresDb(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    max: 10,
    transform: { undefined: null },
    types: {
      // Epoch-millisecond columns are BIGINT on Postgres, and postgres.js hands
      // those back as strings by default. Parse them to numbers so timestamps
      // behave identically on both drivers.
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number | bigint) => String(value),
        parse: (value: string) => Number(value),
      },
    },
  });

  const wrap = (conn: typeof sql): Db => ({
    driver: "postgres",
    async all<T>(text: string, params: unknown[] = []) {
      return (await conn.unsafe(toPositional(text), params as never[])) as unknown as T[];
    },
    async get<T>(text: string, params: unknown[] = []) {
      const rows = (await conn.unsafe(toPositional(text), params as never[])) as unknown as T[];
      return rows[0];
    },
    async run(text: string, params: unknown[] = []) {
      await conn.unsafe(toPositional(text), params as never[]);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return conn.begin((tx) => fn(wrap(tx as unknown as typeof sql))) as Promise<T>;
    },
    async close() {
      await conn.end();
    },
  });

  return wrap(sql);
}
