import { type Client, Events } from "discord.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { moderationFeature } from "../../shared/features.js";
import { getSettings, runAction } from "./actions.js";
import { ModError } from "./checks.js";
import * as store from "./store.js";

/**
 * Temporary bans: lifts them when their time is up.
 * Checks once a minute, and right after startup to catch any that ran out while the bot was offline.
 * The bans live in the database, so restarts never lose them.
 */

const log = (...args: unknown[]) => console.warn("[moderation]", ...args);
let running = false;
/** Case IDs that failed recently, with when to try again (so a missing permission doesn't spam the console every minute). */
const retryAfter = new Map<number, number>();
const RETRY_MS = 60 * 60_000;

async function liftOne(client: Client, c: store.CaseRow) {
  const guild = client.guilds.cache.get(c.guildId);
  if (!guild) return; // the bot isn't connected to that server right now; try again later
  // A switched-off feature keeps its temporary bans waiting rather than silently dropping them.
  if (!(await isFeatureEnabled(guild.id, moderationFeature))) return;

  const ban = await guild.bans.fetch({ user: c.userId, force: true }).catch(() => null);
  if (!ban) {
    // Someone already unbanned them by hand.
    await store.deactivate(guild.id, c.userId, "ban");
    return;
  }
  const me = guild.members.me!;
  try {
    await runAction(guild, {
      action: "unban",
      user: ban.user,
      member: null,
      moderator: { id: me.id, tag: me.user.tag, member: null },
      reason: `Temporary ban from case #${c.caseNumber} ended`,
      auto: true,
    }, await getSettings(guild.id));
  } catch (err) {
    retryAfter.set(c.id, Date.now() + RETRY_MS);
    const why = err instanceof ModError ? err.message.replace(/\*\*/g, "") : String(err);
    log(`couldn't lift the temporary ban from case #${c.caseNumber} in ${guild.name} (${guild.id}): ${why}`);
  }
}

async function liftDue(client: Client) {
  if (running || !client.isReady()) return;
  running = true;
  try {
    const now = new Date();
    await store.expireTimeouts(now);
    const due = await store.dueBans(now, 200);
    for (const c of due) {
      if ((retryAfter.get(c.id) ?? 0) > Date.now()) continue;
      retryAfter.delete(c.id);
      await liftOne(client, c).catch((err) => log("temporary ban check failed:", err));
    }
  } finally {
    running = false;
  }
}

export function startBanTimers(client: Client) {
  client.once(Events.ClientReady, () => {
    liftDue(client).catch((err) => log("temporary ban check failed:", err));
  });
  setInterval(() => {
    liftDue(client).catch((err) => log("temporary ban check failed:", err));
  }, 60_000).unref();
}
