import { Client, GatewayIntentBits, Partials } from "discord.js";
import { startupPresence } from "./presence.js";

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
  // Partials let the bot react to events on messages, reactions and members it hasn't cached (e.g. after a restart).
  // Shows "Applying changes…" from the first moment the bot connects (see presence.ts).
  presence: startupPresence(),
  partials: [Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
});
