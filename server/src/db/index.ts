import { isAbsolute, resolve } from "node:path";
import { config, repoRoot } from "../config.js";
import { createPostgresDb, createSqliteDb, type Db } from "./adapter.js";
import { migrate } from "./schema.js";

let instance: Db | undefined;

export async function getDb(): Promise<Db> {
  if (instance) return instance;

  if (config.db.driver === "postgres") {
    instance = await createPostgresDb(config.db.url);
  } else {
    const file = isAbsolute(config.db.url) ? config.db.url : resolve(repoRoot, config.db.url);
    instance = await createSqliteDb(file);
  }

  await migrate(instance);
  return instance;
}

export async function closeDb(): Promise<void> {
  await instance?.close();
  instance = undefined;
}

export type { Db };
