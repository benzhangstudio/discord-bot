import type { Client } from "discord.js";
import { eq, inArray, lt } from "drizzle-orm";
import { db, sqlite } from "./db/client.js";
import {
  featureSettings,
  guildSetup,
  moderationCases,
  onboardingProgress,
  onboardingState,
  reactionRoleMessages,
  reactionRoleStats,
  reactionRoleTimers,
  removedGuilds,
} from "./db/schema.js";

/**
 * Deleting a server's data, as Discord's Developer Terms require (section 5(b)):
 * - an owner can delete it right away from the dashboard
 * - when the bot is removed from a server, its data is deleted after a 30-day grace period
 *   (in case it was removed by mistake), unless the bot is added back first
 *
 * ⚠️ When a feature adds a table with server data, add it to the two lists below.
 */
const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** Every table that holds data for a server, by its guild_id column. */
const guildTables = [featureSettings, guildSetup, reactionRoleMessages, reactionRoleTimers, onboardingProgress, onboardingState, moderationCases];

/** Deletes everything stored about a server. */
export async function deleteGuildData(guildId: string) {
  sqlite.exec("BEGIN");
  try {
    // Stats are keyed by menu, not server, so delete them through the server's menus first.
    const menus = db.select({ id: reactionRoleMessages.messageId }).from(reactionRoleMessages).where(eq(reactionRoleMessages.guildId, guildId));
    await db.delete(reactionRoleStats).where(inArray(reactionRoleStats.messageId, menus)).run();
    // Deleting a menu also deletes its emoji → role entries.
    for (const table of guildTables) await db.delete(table).where(eq(table.guildId, guildId)).run();
    await db.delete(removedGuilds).where(eq(removedGuilds.guildId, guildId)).run();
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
  console.log(`[data] deleted all data for server ${guildId}`);
}

/** Starts the 30-day countdown for a server the bot was removed from. */
export async function markRemoved(guildId: string, at = new Date()) {
  await db.insert(removedGuilds).values({ guildId, removedAt: at }).onConflictDoNothing().run();
}

/** The bot is back in the server: keep its data. */
export async function unmarkRemoved(guildId: string) {
  await db.delete(removedGuilds).where(eq(removedGuilds.guildId, guildId)).run();
}

/** Servers with stored data that the bot isn't in (e.g. it was removed while offline) start their countdown. */
async function markMissingGuilds(client: Client) {
  const ids = new Set<string>();
  for (const table of guildTables) {
    for (const row of await db.selectDistinct({ id: table.guildId }).from(table).all()) ids.add(row.id);
  }
  for (const id of ids) if (!client.guilds.cache.has(id)) await markRemoved(id);
}

/** Deletes the data of servers whose 30 days are up. */
async function deleteExpired(client: Client) {
  const due = await db.select().from(removedGuilds).where(lt(removedGuilds.removedAt, new Date(Date.now() - GRACE_MS))).all();
  for (const { guildId } of due) {
    if (client.guilds.cache.has(guildId)) await unmarkRemoved(guildId); // added back without us noticing
    else await deleteGuildData(guildId);
  }
}

/** Runs once the bot has connected, then hourly. */
export function startGuildDataCleanup(client: Client) {
  const run = async () => {
    await markMissingGuilds(client);
    await deleteExpired(client);
  };
  run().catch((err) => console.error("[data] cleanup failed:", err));
  setInterval(() => deleteExpired(client).catch((err) => console.error("[data] cleanup failed:", err)), 60 * 60 * 1000).unref();
}
