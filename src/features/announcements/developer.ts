import { Team } from "discord.js";
import { client } from "../../server/bot/discord.js";

/**
 * The bot's developer is whoever owns the application in the Discord Developer Portal
 * (or owns the team that does). Nothing to configure.
 */
let cache: { at: number; ids: string[] } | undefined;
const CACHE_MS = 10 * 60_000;

export async function developerIds(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.ids;
  if (!client.isReady()) return cache?.ids ?? [];
  try {
    const app = await client.application.fetch();
    const owner = app.owner;
    const ids = owner instanceof Team ? (owner.ownerId ? [owner.ownerId] : []) : owner ? [owner.id] : [];
    cache = { at: Date.now(), ids };
    return ids;
  } catch (err) {
    console.warn("[announcements] couldn't look up the bot's owner:", (err as Error).message);
    return cache?.ids ?? [];
  }
}

export const isDeveloper = async (userId: string) => (await developerIds()).includes(userId);
