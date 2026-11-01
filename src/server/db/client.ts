import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { config } from "../config.js";
import * as schema from "./schema.js";

/**
 * The database is a single SQLite file, opened with the SQLite engine built into Node.js.
 * Nothing has to be compiled during install, which keeps Wispbyte startups reliable.
 */
mkdirSync(config.dataDir, { recursive: true });
export const dbPath = join(config.dataDir, "number-one.db");
export const sqlite = new DatabaseSync(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

type Param = null | number | bigint | string | Uint8Array;

// Drizzle sends each query here; we run it on node:sqlite and hand back rows as value arrays.
export const db = drizzle(
  async (sql, params, method) => {
    const statement = sqlite.prepare(sql);
    const args = params as Param[];
    if (method === "run") {
      statement.run(...args);
      return { rows: [] };
    }
    statement.setReturnArrays(true);
    if (method === "get") {
      const row = statement.get(...args);
      return { rows: (row ?? undefined) as unknown as unknown[] };
    }
    return { rows: statement.all(...args) as unknown as unknown[][] };
  },
  { schema },
);

/** Applies any new database migrations. Runs on every startup; already-applied ones are skipped. */
export async function runMigrations() {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  await migrate(
    db,
    async (queries) => {
      sqlite.exec("BEGIN");
      try {
        for (const query of queries) sqlite.exec(query);
        sqlite.exec("COMMIT");
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    { migrationsFolder: join(projectRoot, "drizzle") },
  );
}
