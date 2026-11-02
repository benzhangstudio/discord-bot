import { Client, GatewayIntentBits, IntentsBitField, Partials } from "discord.js";

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
    GatewayIntentBits.AutoModerationExecution, // Discord AutoMod catches, so Number One can warn, time out or kick
    GatewayIntentBits.MessageContent, // privileged: enable "Message Content Intent" (auto-moderation's own filters)
  ],
  // Partials let the bot react to events on messages, reactions and members it hasn't cached (e.g. after a restart).
  partials: [Partials.GuildMember, Partials.Message, Partials.Reaction, Partials.User, Partials.Channel],
});

/**
 * Whether Number One can read what messages say. False when "Message Content Intent" is off in the
 * Developer Portal: the bot then logs in without it, and the features that need it explain the problem.
 */
export const canReadMessages = () => client.options.intents.has(GatewayIntentBits.MessageContent);

/** Drops the Message Content intent, for logging in when it isn't enabled in the Developer Portal. */
export function dropMessageContent() {
  client.options.intents = new IntentsBitField(client.options.intents.bitfield).remove(GatewayIntentBits.MessageContent);
}
