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

export async function createSqliteDb(file: string): Promise<Db> {
  const { default: Database } = await import("better-sqlite3");
  const { mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");

  mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);

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
