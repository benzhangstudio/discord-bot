import { Events } from "discord.js";
import { onEvent } from "../../server/bot/types.js";
import { markRemoved, unmarkRemoved } from "../../server/guildData.js";

// GuildDelete only fires when the bot is really removed (an outage fires GuildUnavailable instead).
export const guildRemoved = onEvent(Events.GuildDelete, async (guild) => {
  await markRemoved(guild.id);
});

export const guildAdded = onEvent(Events.GuildCreate, async (guild) => {
  await unmarkRemoved(guild.id);
});
