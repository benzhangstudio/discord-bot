import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandUserOption,
  type User,
} from "discord.js";
import type { SlashCommand } from "../../server/bot/types.js";
import { dashboardLink } from "../../server/config.js";
import {
  type CaseAction,
  MAX_REASON,
  actionInfo,
  caseActions,
  formatDuration,
  parseDuration,
} from "../../shared/moderation.js";
import { type ActionResult, type Moderator, getSettings, runAction } from "./actions.js";
import { ModError, checkCanAct, checkReason } from "./checks.js";
import { caseEmbed, caseTitle, postNote, refreshLog } from "./messages.js";
import * as store from "./store.js";

/*
 * Moderation commands. Results of actions are posted publicly, like the rest of Number One, so staff can see
 * who did what. Looking up someone's record (/case history, /case view) replies privately, because a member's
 * history shouldn't be shown to whoever happens to be in the channel.
 */

const privately = { flags: MessageFlags.Ephemeral } as const;

const userOption = (o: SlashCommandUserOption, what: string) => o.setName("user").setDescription(what).setRequired(true);

const reasonOption = (b: { addStringOption: SlashCommandBuilder["addStringOption"] }) =>
  b.addStringOption((o) => o.setName("reason").setDescription("Why. Shown to the member and in the mod log.").setMaxLength(MAX_REASON));

const moderatorOf = (interaction: ChatInputCommandInteraction): Moderator => ({
  id: interaction.user.id,
  tag: interaction.user.tag,
  member: interaction.member as GuildMember,
});

async function fail(interaction: ChatInputCommandInteraction | AutocompleteInteraction, err: unknown) {
  if (!(err instanceof ModError)) throw err;
  if (interaction.isAutocomplete()) return;
  const content = `❌ ${err.message}`;
  return interaction.deferred || interaction.replied
    ? interaction.editReply({ content, embeds: [] })
    : interaction.reply({ content, ...privately });
}

/** The public confirmation after an action, plus any automatic follow-up. */
function resultMessage(user: User, action: CaseAction, result: ActionResult) {
  const c = result.case;
  const info = actionInfo[action];
  const lines = [`${info.emoji} **${user.username}** was ${info.past}${c.durationMs ? ` for ${formatDuration(c.durationMs)}` : ""}. ${c.reason ? `Reason: ${c.reason}` : ""}`.trim()];
  if (["warn", "timeout", "kick", "ban"].includes(action) && !c.dmSent) lines.push("-# I couldn't DM them about it (their DMs are closed or turned off here).");
  for (const f of result.followUps) {
    const fi = actionInfo[f.action as CaseAction];
    lines.push(`${fi.emoji} They were also automatically ${fi.past}${f.durationMs ? ` for ${formatDuration(f.durationMs)}` : ""} (${f.reason}). Case #${f.caseNumber}`);
  }
  lines.push(`-# Case #${c.caseNumber}`);
  return { content: lines.join("\n"), allowedMentions: { parse: [] } };
}

/**
 * Shared flow for the action commands: read the options, check quickly (private error), then defer
 * publicly while the DM and Discord action run, and post the result.
 */
async function act(
  interaction: ChatInputCommandInteraction,
  action: CaseAction,
  extra: (guild: Guild) => { durationMs?: number | null; deleteMessageSeconds?: number } = () => ({}),
) {
  const guild = interaction.guild!;
  const user = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason") ?? "";
  try {
    const options = extra(guild);
    // Check before deferring, so a refusal is only shown to the moderator.
    const [settings, member] = await Promise.all([getSettings(guild.id), guild.members.fetch(user.id).catch(() => null)]);
    const moderator = moderatorOf(interaction);
    checkReason(settings, reason);
    checkCanAct(guild, action, moderator.member, { user, member });
    await interaction.deferReply();
    const result = await runAction(guild, { action, user, member, moderator, reason, ...options }, settings);
    await interaction.editReply(resultMessage(user, action, result));
  } catch (err) {
    await fail(interaction, err);
  }
}

/** Reads the duration option. `optional` allows it to be empty (permanent ban). */
function readDuration(interaction: ChatInputCommandInteraction, optional: boolean): number | null {
  const text = interaction.options.getString("duration") ?? "";
  if (!text.trim() || (optional && /^perm(anent)?$/i.test(text.trim()))) {
    if (optional) return null;
    throw new ModError("Give a length, like `10m`, `1h` or `1d`.");
  }
  const ms = parseDuration(text);
  if (!ms) throw new ModError(`I couldn't read **${text}** as a length. Try something like \`30m\`, \`2h\`, \`1d\` or \`1w\`.`);
  return ms;
}

const QUICK_DURATIONS = ["10m", "30m", "1h", "6h", "12h", "1d", "3d", "1w", "2w", "28d"];

/** Suggestions for the duration option: what they typed, read back, plus common lengths. */
function durationSuggestions(interaction: AutocompleteInteraction, permanent: boolean) {
  const typed = interaction.options.getFocused().trim();
  const max = permanent ? 365 * 86_400_000 : 28 * 86_400_000;
  const out: { name: string; value: string }[] = [];
  const parsed = typed ? parseDuration(typed) : null;
  if (parsed && parsed <= max) out.push({ name: formatDuration(parsed), value: typed.slice(0, 100) });
  if (permanent && (!typed || "permanent".startsWith(typed.toLowerCase()))) out.push({ name: "Permanent", value: "permanent" });
  for (const d of QUICK_DURATIONS) {
    const ms = parseDuration(d)!;
    if (ms > max || out.some((o) => o.value === d)) continue;
    if (!typed || d.startsWith(typed.toLowerCase()) || formatDuration(ms).startsWith(typed.toLowerCase())) {
      out.push({ name: formatDuration(ms), value: d });
    }
  }
  return interaction.respond(out.slice(0, 25));
}

/* ------------------------------------------------------------- commands */

const warn: SlashCommand = {
  data: reasonOption(
    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn a member. Repeat warnings can trigger automatic steps.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => userOption(o, "Who to warn")),
  ),
  execute: (interaction) => act(interaction, "warn"),
};

const timeout: SlashCommand = {
  data: reasonOption(
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Time a member out: they can't chat, react or join voice for a while.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => userOption(o, "Who to time out"))
      .addStringOption((o) =>
        o.setName("duration").setDescription("How long, like 10m, 1h or 1d (up to 28 days)").setRequired(true).setAutocomplete(true).setMaxLength(50),
      ),
  ),
  execute: (interaction) => act(interaction, "timeout", () => ({ durationMs: readDuration(interaction, false) })),
  autocomplete: (interaction) => durationSuggestions(interaction, false),
};

const untimeout: SlashCommand = {
  data: reasonOption(
    new SlashCommandBuilder()
      .setName("untimeout")
      .setDescription("End a member's timeout early.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => userOption(o, "Whose timeout to end")),
  ),
  execute: (interaction) => act(interaction, "untimeout"),
};

const kick: SlashCommand = {
  data: reasonOption(
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Remove a member from the server. They can rejoin with an invite.")
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => userOption(o, "Who to kick")),
  ),
  execute: (interaction) => act(interaction, "kick"),
};

const DELETE_CHOICES = [
  { name: "Don't delete any", value: 0 },
  { name: "Previous hour", value: 3_600 },
  { name: "Previous 6 hours", value: 21_600 },
  { name: "Previous 24 hours", value: 86_400 },
  { name: "Previous 3 days", value: 259_200 },
  { name: "Previous 7 days", value: 604_800 },
];

const ban: SlashCommand = {
  data: reasonOption(
    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban someone, for good or for a while. Works on people who already left, too.")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .setContexts(InteractionContextType.Guild)
      .addUserOption((o) => userOption(o, "Who to ban (or paste their user ID)"))
      .addStringOption((o) =>
        o.setName("duration").setDescription("Leave empty for a permanent ban, or e.g. 1d, 1w, 30d").setAutocomplete(true).setMaxLength(50),
      ),
  )
    .addIntegerOption((o) =>
      o.setName("delete_messages").setDescription("Delete their recent messages (default set on the dashboard)").addChoices(...DELETE_CHOICES),
    ),
  execute: (interaction) =>
    act(interaction, "ban", () => ({
      durationMs: readDuration(interaction, true),
      deleteMessageSeconds: interaction.options.getInteger("delete_messages") ?? undefined,
    })),
  autocomplete: (interaction) => durationSuggestions(interaction, true),
};

/* Recently fetched ban lists, for /unban suggestions. */
const banCache = new Map<string, { at: number; bans: { id: string; name: string }[] }>();

const unban: SlashCommand = {
  data: reasonOption(
    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("Lift a ban.")
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .setContexts(InteractionContextType.Guild)
      .addStringOption((o) => o.setName("user").setDescription("Who to unban (pick from the list or paste a user ID)").setRequired(true).setAutocomplete(true)),
  ),
  async execute(interaction) {
    const guild = interaction.guild!;
    const raw = interaction.options.getString("user", true).trim();
    const id = raw.match(/\d{17,20}/)?.[0];
    if (!id) return interaction.reply({ content: "❌ Pick someone from the list, or paste their user ID.", ...privately });
    const user = await interaction.client.users.fetch(id).catch(() => null);
    if (!user) return interaction.reply({ content: "❌ I couldn't find a Discord user with that ID.", ...privately });
    const reason = interaction.options.getString("reason") ?? "";
    try {
      const settings = await getSettings(guild.id);
      const moderator = moderatorOf(interaction);
      checkReason(settings, reason);
      checkCanAct(guild, "unban", moderator.member, { user, member: null });
      if (!(await guild.bans.fetch({ user: id, force: true }).catch(() => null))) throw new ModError(`**${user.username}** isn't banned.`);
      await interaction.deferReply();
      const result = await runAction(guild, { action: "unban", user, member: null, moderator, reason }, settings);
      banCache.delete(guild.id);
      await interaction.editReply(resultMessage(user, "unban", result));
    } catch (err) {
      await fail(interaction, err);
    }
  },
  async autocomplete(interaction) {
    const guild = interaction.guild!;
    let cached = banCache.get(guild.id);
    if (!cached || Date.now() - cached.at > 60_000) {
      const bans = await guild.bans.fetch({ limit: 1000 }).catch(() => null);
      cached = { at: Date.now(), bans: [...(bans?.values() ?? [])].map((b) => ({ id: b.user.id, name: b.user.tag })) };
      banCache.set(guild.id, cached);
    }
    const typed = interaction.options.getFocused().toLowerCase();
    const matches = cached.bans.filter((b) => !typed || b.name.toLowerCase().includes(typed) || b.id.startsWith(typed));
    return interaction.respond(matches.slice(0, 25).map((b) => ({ name: `${b.name} (${b.id})`.slice(0, 100), value: b.id })));
  },
};

const purge: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete recent messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName("amount").setDescription("How many messages to check (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName("user").setDescription("Only delete messages from this person"))
    .addStringOption((o) => o.setName("contains").setDescription("Only delete messages containing this text").setMaxLength(100)),
  async execute(interaction) {
    const channel = interaction.channel;
    const me = interaction.guild!.members.me!;
    if (!channel || channel.isDMBased() || !("bulkDelete" in channel)) {
      return interaction.reply({ content: "❌ I can't purge messages in this channel.", ...privately });
    }
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])) {
      return interaction.reply({ content: "❌ I need **Manage Messages** and **Read Message History** in this channel.", ...privately });
    }
    const amount = interaction.options.getInteger("amount", true);
    const user = interaction.options.getUser("user");
    const contains = interaction.options.getString("contains")?.toLowerCase();

    await interaction.deferReply(privately);
    const recent = await channel.messages.fetch({ limit: amount, before: interaction.id }).catch(() => null);
    if (!recent) return interaction.editReply("❌ I couldn't read this channel's messages.");
    const twoWeeksAgo = Date.now() - 14 * 86_400_000 + 60_000;
    const targets = recent.filter(
      (m) =>
        !m.pinned &&
        m.createdTimestamp > twoWeeksAgo &&
        (!user || m.author.id === user.id) &&
        (!contains || m.content.toLowerCase().includes(contains)),
    );
    if (!targets.size) return interaction.editReply("Nothing matched. Messages older than 14 days and pinned messages are skipped.");
    const deleted = await channel.bulkDelete(targets, true).catch(() => null);
    if (!deleted) return interaction.editReply("❌ Discord didn't let me delete those messages.");

    const filters = [user ? `from ${user.tag}` : "", contains ? `containing “${contains}”` : ""].filter(Boolean).join(", ");
    await postNote(
      interaction.guild!,
      await getSettings(interaction.guildId!),
      "🧹 Messages purged",
      `**${deleted.size}** message${deleted.size === 1 ? "" : "s"} in <#${channel.id}>${filters ? ` (${filters})` : ""}\n**Moderator:** <@${interaction.user.id}> (${interaction.user.tag})`,
    );
    return interaction.editReply(
      `🧹 Deleted **${deleted.size}** message${deleted.size === 1 ? "" : "s"}.${targets.size > deleted.size ? " Some were too old to bulk-delete." : ""}`,
    );
  },
};

/* --------------------------------------------------------------- /case */

const HISTORY_PAGE = 10;

const actionFilterChoices = caseActions.map((a) => ({ name: actionInfo[a].label, value: a }));

const caseCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("case")
    .setDescription("Look up and manage moderation cases.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName("history")
        .setDescription("A member's moderation history (only you see it).")
        .addUserOption((o) => userOption(o, "Whose history"))
        .addStringOption((o) => o.setName("type").setDescription("Only show one kind of case").addChoices(...actionFilterChoices)),
    )
    .addSubcommand((s) =>
      s
        .setName("view")
        .setDescription("Show one case (only you see it).")
        .addIntegerOption((o) => o.setName("number").setDescription("Case number").setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName("note")
        .setDescription("Add a private staff note to a member's history. They aren't told.")
        .addUserOption((o) => userOption(o, "Who the note is about"))
        .addStringOption((o) => o.setName("note").setDescription("The note").setRequired(true).setMaxLength(MAX_REASON)),
    )
    .addSubcommand((s) =>
      s
        .setName("reason")
        .setDescription("Change a case's reason. Updates the mod log too.")
        .addIntegerOption((o) => o.setName("number").setDescription("Case number").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("reason").setDescription("The new reason").setRequired(true).setMaxLength(MAX_REASON)),
    )
    .addSubcommand((s) =>
      s
        .setName("delete")
        .setDescription("Delete a case, e.g. a warning given by mistake. Needs Manage Server.")
        .addIntegerOption((o) => o.setName("number").setDescription("Case number").setRequired(true).setMinValue(1)),
    ),

  async execute(interaction) {
    const guild = interaction.guild!;
    const member = interaction.member as GuildMember;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === "note") {
        const user = interaction.options.getUser("user", true);
        await interaction.deferReply(privately);
        const result = await runAction(guild, {
          action: "note",
          user,
          moderator: moderatorOf(interaction),
          reason: interaction.options.getString("note", true),
        });
        return interaction.editReply({ content: `📝 Note added to **${user.username}**'s history. Case #${result.case.caseNumber}`, allowedMentions: { parse: [] } });
      }

      if (sub === "history") {
        const user = interaction.options.getUser("user", true);
        const type = interaction.options.getString("type") as CaseAction | null;
        const [cases, counts] = await Promise.all([
          store.listCases(guild.id, { userId: user.id, actions: type ? [type] : undefined, limit: HISTORY_PAGE }),
          store.countsFor(guild.id, user.id),
        ]);
        const summary = caseActions
          .filter((a) => counts[a])
          .map((a) => `${actionInfo[a].emoji} ${counts[a]} ${actionInfo[a].label.toLowerCase()}${counts[a] === 1 ? "" : "s"}`)
          .join(" · ");
        const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
        const lines = cases.map((c) => {
          const t = `<t:${Math.floor(c.createdAt.getTime() / 1000)}:d>`;
          const length = c.durationMs ? ` (${formatDuration(c.durationMs)})` : "";
          const reason = c.reason ? `: ${c.reason.length > 80 ? `${c.reason.slice(0, 80)}…` : c.reason}` : "";
          return `**#${c.caseNumber}** ${actionInfo[c.action as CaseAction]?.emoji ?? ""} ${actionInfo[c.action as CaseAction]?.label ?? c.action}${length} · ${t} · by ${c.auto ? "Number One" : c.moderatorTag}${reason}`;
        });
        const link = dashboardLink(`/servers/${guild.id}/moderation`);
        const embed = new EmbedBuilder()
          .setColor(0xff4fa3)
          .setAuthor({ name: `${user.tag}'s history`, iconURL: user.displayAvatarURL() })
          .setDescription(
            total
              ? [summary, "", ...lines, total > cases.length ? `\n-# Showing the latest ${cases.length}.${link ? ` See everything on the [dashboard](${link}).` : ""}` : ""].join("\n")
              : "No cases. Clean record.",
          )
          .setFooter({ text: `User ID ${user.id}` });
        return interaction.reply({ embeds: [embed], ...privately });
      }

      const number = interaction.options.getInteger("number", true);
      const found = await store.getCase(guild.id, number);
      if (!found) return interaction.reply({ content: `❌ There's no case #${number}.`, ...privately });

      if (sub === "view") return interaction.reply({ embeds: [caseEmbed(found)], ...privately });

      if (sub === "reason") {
        const isAuthor = found.moderatorId === interaction.user.id;
        if (!isAuthor && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          throw new ModError("Only the moderator who made this case, or someone with **Manage Server**, can change its reason.");
        }
        found.reason = interaction.options.getString("reason", true).trim();
        await store.updateCase(found.id, { reason: found.reason });
        await refreshLog(guild, found);
        return interaction.reply({ content: `✏️ Updated the reason for ${caseTitle(found)}.`, ...privately });
      }

      if (sub === "delete") {
        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new ModError("Deleting cases needs the **Manage Server** permission.");
        await store.deleteCase(found.id);
        await refreshLog(guild, found, { deletedBy: interaction.user.tag });
        const note = found.active ? " The ban or timeout itself is still in place; use /unban or /untimeout to lift it." : "";
        return interaction.reply({ content: `🗑️ Deleted ${caseTitle(found)}.${note}` });
      }
    } catch (err) {
      return fail(interaction, err);
    }
  },
};

export const moderationCommands: SlashCommand[] = [warn, timeout, untimeout, kick, ban, unban, purge, caseCommand];
