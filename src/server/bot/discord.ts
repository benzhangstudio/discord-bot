import { Client, GatewayIntentBits, Partials } from "discord.js";
import { idlePresence } from "./presence.js";

/**
 * The Discord connection. Kept in its own file (with no feature imports) so features and
 * the dashboard API can use it without creating an import loop.
 */
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged: enable "Server Members Intent" in the Developer Portal
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // The status under the bot's name on its Discord profile.
  presence: idlePresence,
  // Partials let the bot react to events on messages, reactions and members it hasn't cached (e.g. after a restart).
  partials: [Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
});
