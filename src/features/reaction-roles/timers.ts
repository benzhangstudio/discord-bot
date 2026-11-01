import { type Client, Events } from "discord.js";
import { inOrder } from "./apply.js";
import { fetchConfigMessage, roleProblem } from "./message.js";
import { reactionKey } from "./emoji.js";
import * as store from "./store.js";

/**
 * Temporary roles: takes roles away when their time is up.
 * Checks once a minute (and right after startup, to catch anything that ran out while offline).
 * Timers live in the database, so restarts never lose them.
 */

const log = (...args: unknown[]) => console.warn("[reaction-roles]", ...args);
let running = false;

async function expireOne(client: Client, t: store.RoleTimer) {
  const guild = client.guilds.cache.get(t.guildId);
  if (!guild) return store.deleteTimer(t); // the bot left this server
  const member = await guild.members.fetch(t.userId).catch(() => null);
  if (!member) return store.deleteTimer(t); // they left; the role went with them

  if (member.roles.cache.has(t.roleId)) {
    const problem = roleProblem(guild, t.roleId);
    if (problem) {
      log(`couldn't take away temporary role ${t.roleId} in ${guild.name} (${guild.id}): ${problem}`);
    } else {
      await member.roles
        .remove(t.roleId, "Reaction roles: temporary role ran out")
        .then(() => store.recordUse(t.messageId, [], [t.roleId]).catch(() => {}))
        .catch((err) => log("couldn't take away a temporary role:", err?.message ?? err));
    }
  }
  await store.deleteTimer(t);

  // On emoji menus, clear their reaction too so the message matches and they can react again.
  const config = await store.getConfig(t.messageId);
  if (config && config.kind === "reactions" && config.mode !== "reversed" && config.guildId === guild.id) {
    const entry = config.entries.find((e) => e.roleId === t.roleId);
    const message = entry ? await fetchConfigMessage(client, config).catch(() => null) : null;
    const reaction = message?.reactions.cache.find((r) => reactionKey(r.emoji) === entry!.emojiKey);
    await reaction?.users.remove(t.userId).catch(() => {});
  }
}

async function expireDue(client: Client) {
  if (running || !client.isReady()) return;
  running = true;
  try {
    for (let round = 0; round < 10; round++) {
      const due = await store.dueTimers(new Date());
      if (!due.length) break;
      for (const t of due) {
        // Same queue as members' own clicks, so an expiry never races a fresh pick.
        await inOrder(t.guildId, t.userId, () => expireOne(client, t)).catch((err) => {
          log("temporary role check failed:", err);
          return store.deleteTimer(t);
        });
      }
      if (due.length < 200) break;
    }
  } finally {
    running = false;
  }
}

export function startRoleTimers(client: Client) {
  client.once(Events.ClientReady, () => {
    expireDue(client).catch((err) => log("temporary role check failed:", err));
  });
  setInterval(() => {
    expireDue(client).catch((err) => log("temporary role check failed:", err));
  }, 60_000).unref();
}
