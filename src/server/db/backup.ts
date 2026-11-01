import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { backup } from "node:sqlite";
import { config } from "../config.js";
import { sqlite } from "./client.js";

const BACKUP_DIR = join(config.DATA_DIR, "backups");
const KEEP = 7; // days of backups to keep
const DAY_MS = 24 * 60 * 60 * 1000;

function listBackups() {
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .sort(); // file names are timestamps, so this is oldest → newest
}

async function backupIfDue() {
  const existing = listBackups();
  const newest = existing.at(-1);
  if (newest && Date.now() - statSync(join(BACKUP_DIR, newest)).mtimeMs < DAY_MS) return;

  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  await backup(sqlite, join(BACKUP_DIR, name));
  console.log(`[backup] saved ${name}`);

  for (const old of listBackups().slice(0, -KEEP)) rmSync(join(BACKUP_DIR, old));
}

/**
 * Keeps a daily copy of the database in data/backups (last 7 days),
 * downloadable from the Wispbyte file manager.
 */
export function startBackups() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const run = () => backupIfDue().catch((err) => console.error("[backup] failed:", err));
  run();
  setInterval(run, 60 * 60 * 1000).unref(); // check hourly
}
