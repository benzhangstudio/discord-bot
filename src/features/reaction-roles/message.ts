import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  DiscordAPIError,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  type MessageActionRowComponentBuilder,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";
import { reactionKey } from "./emoji.js";
import type { ReactionRoleKind, ReactionRoleMode } from "../../shared/reactionRoles.js";
import type { ReactionRoleConfig, ReactionRoleEntry } from "./store.js";

export const BRAND_PINK = 0xff4fa3;

const PERMISSION_NAMES: Record<string, string> = {
  [String(PermissionFlagsBits.ViewChannel)]: "View Channel",
  [String(PermissionFlagsBits.SendMessages)]: "Send Messages",
  [String(PermissionFlagsBits.EmbedLinks)]: "Embed Links",
  [String(PermissionFlagsBits.AddReactions)]: "Add Reactions",
  [String(PermissionFlagsBits.ReadMessageHistory)]: "Read Message History",
  [String(PermissionFlagsBits.ManageMessages)]: "Manage Messages",
};

type Setup = Pick<ReactionRoleConfig, "kind" | "mode" | "options"> & { external?: boolean };

/** Permissions the bot needs in the channel to run a message of this kind. */
function requiredPermissions(setup: Setup) {
  // On someone else's message the bot only reads it and adds reactions.
  if (setup.external) return [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AddReactions];
  const perms: bigint[] = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];
  if (setup.options.embed.enabled) perms.push(PermissionFlagsBits.EmbedLinks);
  if (setup.kind === "reactions") perms.push(PermissionFlagsBits.AddReactions);
  return perms;
}

/** Lists the channel permissions the bot is missing, in plain words (empty when all is well). */
export function missingChannelPermissions(channel: GuildTextBasedChannel, setup: Setup): string[] {
  const me = channel.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  return requiredPermissions(setup)
    .filter((p) => !perms?.has(p))
    .map((p) => PERMISSION_NAMES[String(p)]);
}

/** Reactions modes that clear members' reactions need Manage Messages. Missing it only weakens those, so it's a warning. */
export function needsManageMessages(setup: Setup) {
  return setup.kind === "reactions" && (setup.mode === "unique" || setup.options.removeReaction);
}

/**
 * What's stopping a saved message from working right now (missing channel, missing permissions,
 * roles the bot can't give), in plain words for the dashboard. Uses only cached data, so it's instant.
 */
export function configProblems(guild: Guild, config: ReactionRoleConfig): string[] {
  const problems: string[] = [];
  const channel = guild.channels.cache.get(config.channelId);
  if (config.external && (!channel || channel.isThread())) {
    // Threads may simply be archived (not cached), so only check permissions when the channel is known.
    if (!channel) return problems;
  } else if (!channel || !channel.isTextBased() || channel.isThread()) {
    problems.push("Its channel was deleted. Edit it and pick a new channel to post it again.");
    return problems;
  }
  if (!channel.isTextBased()) return problems;
  const text = channel as GuildTextBasedChannel;
  const missing = missingChannelPermissions(text, config);
  if (missing.length) problems.push(`I'm missing ${missing.join(", ")} in #${channel.name}.`);
  const me = guild.members.me;
  if (needsManageMessages(config) && me && !text.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
    problems.push(`I need Manage Messages in #${channel.name} to clear members' reactions for this mode.`);
  }
  for (const entry of config.entries) {
    const problem = roleProblem(guild, entry.roleId);
    if (problem) problems.push(`${entry.emojiDisplay || roleName(guild, entry.roleId)}: ${problem.replace(/\*\*/g, "")}`);
  }
  return [...new Set(problems)];
}

const roleName = (guild: Guild | undefined, roleId: string) => guild?.roles.cache.get(roleId)?.name ?? "Deleted role";
/** Button / dropdown text for a row: its own label, or the role's name. */
export const entryLabel = (guild: Guild | undefined, e: ReactionRoleEntry) => (e.label || roleName(guild, e.roleId)).slice(0, 80);

const HINTS: Record<ReactionRoleMode, Record<ReactionRoleKind, string>> = {
  normal: {
    reactions: "React to get a role. Remove your reaction to remove it.",
    buttons: "Click a button to get a role. Click again to remove it.",
    dropdown: "Pick roles from the menu. Un-pick them to remove them.",
  },
  unique: {
    reactions: "Pick one: react to get a role. Choosing another swaps it.",
    buttons: "Pick one: click a button to get that role. Choosing another swaps it.",
    dropdown: "Pick one role from the menu. Choosing another swaps it.",
  },
  verify: {
    reactions: "React to get the role.",
    buttons: "Click to get the role.",
    dropdown: "Pick to get the role.",
  },
  drop: {
    reactions: "React to remove the role.",
    buttons: "Click to remove the role.",
    dropdown: "Pick to remove the role.",
  },
  reversed: {
    reactions: "React to remove the role. Remove your reaction to get it back.",
    buttons: "",
    dropdown: "",
  },
  binding: {
    reactions: "Choose carefully: your pick is permanent.",
    buttons: "Choose carefully: your pick is permanent.",
    dropdown: "Choose carefully: your pick is permanent.",
  },
};

const BUTTON_STYLES: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** Custom IDs for the message's buttons and menu (routed to this feature by the "rr" prefix). */
export const BUTTON_ID = "rr:b:";
export const MENU_ID = "rr:m";

export function buildEmbed(guild: Guild | undefined, config: ReactionRoleConfig) {
  const e = config.options.embed;
  const lines = e.listRoles
    ? config.entries.map((x) => [x.emojiDisplay, `<@&${x.roleId}>`, x.description && config.kind !== "reactions" ? `— ${x.description}` : ""].filter(Boolean).join("  "))
    : [];
  const body = [config.description.trim(), lines.join("\n")].filter(Boolean).join("\n\n");
  const embed = new EmbedBuilder().setColor(Number.parseInt(e.color.slice(1), 16) || BRAND_PINK);
  if (config.title) embed.setTitle(config.title);
  if (body) embed.setDescription(body.slice(0, 4096));
  if (e.image) embed.setImage(e.image);
  if (e.thumbnail) embed.setThumbnail(e.thumbnail);
  const footer = e.footer || HINTS[config.mode][config.kind];
  if (footer) embed.setFooter({ text: footer });
  if (!config.title && !body && !e.image) embed.setDescription("Roles will appear here soon.");
  return embed;
}

/** Buttons or the dropdown menu for a message (empty for emoji reactions). */
export function buildComponents(guild: Guild | undefined, config: ReactionRoleConfig): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  if (config.kind === "buttons") {
    const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    config.entries.slice(0, 25).forEach((entry, i) => {
      if (i % 5 === 0) rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>());
      const button = new ButtonBuilder()
        .setCustomId(`${BUTTON_ID}${entry.roleId}`)
        .setStyle(BUTTON_STYLES[entry.style] ?? ButtonStyle.Secondary);
      if (entry.emojiDisplay) button.setEmoji(entry.emojiDisplay);
      // A button needs a label or an emoji; only fall back to the role name when there's no emoji.
      if (entry.label || !entry.emojiDisplay) button.setLabel(entryLabel(guild, entry));
      rows[rows.length - 1].addComponents(button);
    });
    return rows;
  }
  if (config.kind === "dropdown" && config.entries.length) {
    const count = Math.min(config.entries.length, 25);
    const max = config.mode === "unique" ? 1 : config.options.maxRoles > 0 ? Math.min(config.options.maxRoles, count) : count;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(MENU_ID)
      .setPlaceholder((config.options.placeholder || (max === 1 ? "Choose a role" : "Choose your roles")).slice(0, 150))
      .setMinValues(0)
      .setMaxValues(max)
      .addOptions(
        config.entries.slice(0, 25).map((entry) => {
          const option = new StringSelectMenuOptionBuilder().setValue(entry.roleId).setLabel(entryLabel(guild, entry));
          if (entry.description) option.setDescription(entry.description.slice(0, 100));
          if (entry.emojiDisplay) option.setEmoji(entry.emojiDisplay);
          return option;
        }),
      );
    return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)];
  }
  return [];
}

/** The full message: text, embed and buttons/menu. Role mentions in the text never ping anyone. */
export function buildMessage(guild: Guild | undefined, config: ReactionRoleConfig) {
  return {
    content: config.content.trim(),
    embeds: config.options.embed.enabled ? [buildEmbed(guild, config)] : [],
    components: buildComponents(guild, config),
    allowedMentions: { parse: [] },
  };
}

export const messageUrl = (c: Pick<ReactionRoleConfig, "guildId" | "channelId" | "messageId">) =>
  `https://discord.com/channels/${c.guildId}/${c.channelId}/${c.messageId}`;

export const isDiscordError = (err: unknown, ...codes: number[]) =>
  err instanceof DiscordAPIError && codes.includes(err.code as number);

/** Finds the posted message, or null if it (or its channel) no longer exists. */
export async function fetchConfigMessage(client: Client, config: ReactionRoleConfig): Promise<Message | null> {
  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
  return channel.messages.fetch(config.messageId).catch((err) => {
    if (isDiscordError(err, RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel)) return null;
    throw err;
  });
}

/**
 * Brings the Discord message in line with the saved setup: refreshes the embed,
 * adds any missing reactions and removes the bot's reactions for emojis no longer used.
 * Returns problems to show the admin (empty when everything worked).
 */
export async function syncMessage(client: Client, config: ReactionRoleConfig): Promise<string[]> {
  const problems: string[] = [];
  const message = await fetchConfigMessage(client, config);
  if (!message) return ["The reaction-role message no longer exists."];

  const guild = message.guild ?? undefined;
  // Someone else's message is never edited: the bot only manages its own reactions on it.
  if (!config.external) {
    await message.edit(buildMessage(guild, config)).catch(() => problems.push("I couldn't update the message. Check my permissions in that channel."));
  }

  if (config.kind !== "reactions" && !config.external) {
    // Buttons or a menu: clear any reactions left from when this was an emoji message.
    if (message.reactions.cache.size) {
      await message.reactions.removeAll().catch(async () => {
        for (const r of message.reactions.cache.values()) if (r.me) await r.users.remove(client.user!.id).catch(() => {});
      });
    }
    return problems;
  }

  const wanted = new Set(config.entries.map((e) => e.emojiKey));
  for (const reaction of message.reactions.cache.values()) {
    if (reaction.me && !wanted.has(reactionKey(reaction.emoji))) {
      await reaction.users.remove(client.user!.id).catch(() => {});
    }
  }
  for (const entry of config.entries) {
    const existing = message.reactions.cache.find((r) => reactionKey(r.emoji) === entry.emojiKey);
    if (existing?.me) continue;
    try {
      await message.react(entry.emojiDisplay);
    } catch (err) {
      problems.push(
        isDiscordError(err, RESTJSONErrorCodes.UnknownEmoji)
          ? `${entry.emojiDisplay} can't be used as a reaction (it may have been deleted).`
          : `I couldn't add the ${entry.emojiDisplay} reaction. Check I have Add Reactions in that channel.`,
      );
    }
  }
  return problems;
}

import { roleProblem } from "../../server/bot/roles.js";
export { roleProblem };

/** Takes the bot's own reactions off a message (used when a menu on someone else's message is deleted). */
export async function removeOwnReactions(client: Client, config: ReactionRoleConfig) {
  const message = await fetchConfigMessage(client, config).catch(() => null);
  for (const reaction of message?.reactions.cache.values() ?? []) {
    if (reaction.me) await reaction.users.remove(client.user!.id).catch(() => {});
  }
}
