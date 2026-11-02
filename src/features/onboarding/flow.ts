import {
  ActionRowBuilder,
  type APIMessageComponentEmoji,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type MessageComponentInteraction,
  MessageFlags,
  RESTJSONErrorCodes,
  StringSelectMenuBuilder,
} from "discord.js";
import type { ComponentHandler } from "../../server/bot/types.js";
import type { OnboardingQuestion, OnboardingSettings } from "../../shared/onboarding.js";
import { getAccessState } from "./access.js";
import { PINK, postableChannel, sendWelcome } from "./messages.js";
import { memberCounts, onPrivateJobDone } from "./private.js";
import { applyFinalRoles, rolesFromAnswers } from "./roles.js";
import * as store from "./store.js";

const ID = {
  start: "onboarding:start",
  agree: "onboarding:agree",
  answer: "onboarding:answer:", // + question id
  go: "onboarding:go:", // + step number
  finish: "onboarding:finish",
};

type Step = { kind: "rules" } | { kind: "question"; question: OnboardingQuestion } | { kind: "summary" };

/**
 * Whether members get a Start button. With no rules or questions, the walkthrough is a single
 * "Finish" step, which is still needed so gated members always have a way in.
 */
export const flowActive = (s: OnboardingSettings) => s.flow.enabled && Boolean(s.flow.channelId);

function stepsFor(s: OnboardingSettings): Step[] {
  const steps: Step[] = [];
  if (s.flow.rulesEnabled) steps.push({ kind: "rules" });
  for (const question of s.flow.questions) steps.push({ kind: "question", question });
  steps.push({ kind: "summary" });
  return steps;
}

/** Turns what an admin typed as an emoji into the form Discord's menus expect. */
function menuEmoji(text: string): APIMessageComponentEmoji | undefined {
  if (!text) return;
  const custom = text.match(/^<(a?):(\w+):(\d+)>$/);
  if (custom) return { id: custom[3], name: custom[2], animated: Boolean(custom[1]) };
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(text) ? { name: text } : undefined;
}

/** What blocks moving past a step, in plain words (null when the member can continue). */
function blocker(step: Step, progress: store.Progress) {
  if (step.kind === "rules" && !progress.rulesAccepted) return "Please agree to the rules to continue.";
  if (step.kind === "question" && step.question.required && !(progress.answers[step.question.id]?.length)) {
    return "This question needs an answer.";
  }
  return null;
}

function answerSummary(settings: OnboardingSettings, progress: store.Progress) {
  return settings.flow.questions
    .map((q) => {
      const chosen = (progress.answers[q.id] ?? []).map((id) => q.options.find((o) => o.id === id)?.label).filter(Boolean);
      return `**${q.title}**\n${chosen.length ? chosen.join(", ") : "_skipped_"}`;
    })
    .join("\n\n");
}

/** A bar like ▰▰▱▱ showing how far along the member is. */
const progressBar = (index: number, total: number) => "▰".repeat(index + 1) + "▱".repeat(Math.max(total - index - 1, 0));

/** Roles a member gets for finishing with these answers, as mentions (embeds show them without pinging). */
function rewardMentions(settings: OnboardingSettings, progress: store.Progress) {
  const roles = rolesFromAnswers(settings, progress.answers);
  if (settings.access.verifiedRoleId) roles.add(settings.access.verifiedRoleId);
  return [...roles].map((id) => `<@&${id}>`);
}

/** Builds the private message for the member's current step. */
function render(guild: Guild, settings: OnboardingSettings, progress: store.Progress, note?: string) {
  const steps = stepsFor(settings);
  const index = Math.min(Math.max(progress.step, 0), steps.length - 1);
  const step = steps[index];
  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setAuthor({ name: `${guild.name} · Step ${index + 1} of ${steps.length}`, iconURL: guild.iconURL() ?? undefined });
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  const nav = new ActionRowBuilder<ButtonBuilder>();
  if (index > 0) nav.addComponents(new ButtonBuilder().setCustomId(`${ID.go}${index - 1}`).setLabel("Back").setStyle(ButtonStyle.Secondary));

  if (step.kind === "rules") {
    embed
      .setTitle("📜 Server rules")
      .setDescription(
        `${settings.flow.rules || "Be kind and respectful."}\n\n${progress.rulesAccepted ? "✅ You agreed to the rules." : "Click **I agree** to continue."}`.slice(0, 4096),
      );
    nav.addComponents(
      progress.rulesAccepted
        ? new ButtonBuilder().setCustomId(`${ID.go}${index + 1}`).setLabel("Next").setStyle(ButtonStyle.Primary)
        : new ButtonBuilder().setCustomId(ID.agree).setLabel("I agree").setStyle(ButtonStyle.Success),
    );
  } else if (step.kind === "question") {
    const q = step.question;
    const number = settings.flow.questions.indexOf(q) + 1;
    const chosen = progress.answers[q.id] ?? [];
    embed
      .setTitle(`❓ Question ${number} of ${settings.flow.questions.length}`.slice(0, 256))
      .setDescription(
        [
          `**${q.title}**`,
          q.description,
          "",
          `${q.multiple ? "Pick as many as you like" : "Pick one"} · ${q.required ? "**Required**" : "Optional"}`,
        ]
          .filter((line) => line !== undefined && line !== null)
          .join("\n")
          .replace(/\n{3,}/g, "\n\n"),
      );
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${ID.answer}${q.id}`)
      .setPlaceholder(q.multiple ? "Choose your answers" : "Choose an answer")
      .setMinValues(0)
      .setMaxValues(q.multiple ? q.options.length : 1)
      .addOptions(
        q.options.map((o) => ({
          label: o.label,
          value: o.id,
          description: o.description || undefined,
          emoji: menuEmoji(o.emoji),
          default: chosen.includes(o.id),
        })),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
    const canGo = !blocker(step, progress);
    nav.addComponents(
      new ButtonBuilder()
        .setCustomId(`${ID.go}${index + 1}`)
        .setLabel(chosen.length || q.required ? "Next" : "Skip")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!canGo),
    );
  } else {
    const rewards = rewardMentions(settings, progress);
    const parts = [
      settings.flow.questions.length ? `Here's what you picked. Click **Back** to change anything.\n\n${answerSummary(settings, progress)}` : "You're ready to go.",
      rewards.length ? `**You'll get:** ${rewards.join(" ")}` : "",
      progress.status === "done" ? "Click **Save** to update your roles." : "Click **Finish** to get started.",
    ];
    embed.setTitle(progress.status === "done" ? "✏️ Review your answers" : "✅ Almost done!").setDescription(parts.filter(Boolean).join("\n\n").slice(0, 4096));
    nav.addComponents(new ButtonBuilder().setCustomId(ID.finish).setLabel(progress.status === "done" ? "Save" : "Finish").setStyle(ButtonStyle.Success));
  }

  embed.setFooter({ text: `${progressBar(index, steps.length)}${note ? `  •  ${note}` : ""}` });
  rows.push(nav);
  return { embeds: [embed], components: rows };
}

async function load(interaction: MessageComponentInteraction) {
  if (!interaction.inCachedGuild()) return null;
  const settings = await store.getActiveSettings(interaction.guildId);
  if (!settings || !flowActive(settings)) {
    await interaction.reply({ content: "Onboarding isn't available right now.", flags: MessageFlags.Ephemeral });
    return null;
  }
  const member = interaction.member as GuildMember;
  const progress = (await store.getProgress(interaction.guildId, member.id)) ?? store.newProgress(interaction.guildId, member.id);
  return { settings, member, progress, guild: interaction.guild };
}

export const onboardingComponents: ComponentHandler = {
  prefix: "onboarding",
  async handle(interaction) {
    const ctx = await load(interaction);
    if (!ctx) return;
    const { settings, member, progress, guild } = ctx;
    const id = interaction.customId;
    const steps = stepsFor(settings);

    if (id === ID.start || id === `${ID.start}:edit`) {
      // New members start at the beginning; returning members pick up where they left off.
      if (progress.status === "done") progress.step = 0;
      else progress.status = "started";
      progress.step = Math.min(progress.step, steps.length - 1);
      await store.saveProgress(progress);
      return interaction.reply({ ...render(guild, settings, progress), flags: MessageFlags.Ephemeral });
    }

    if (id === ID.agree) {
      progress.rulesAccepted = true;
      progress.step = Math.min(progress.step + 1, steps.length - 1);
    } else if (id.startsWith(ID.answer) && interaction.isStringSelectMenu()) {
      const qid = id.slice(ID.answer.length);
      const question = settings.flow.questions.find((q) => q.id === qid);
      if (question) progress.answers = { ...progress.answers, [qid]: interaction.values.filter((v) => question.options.some((o) => o.id === v)) };
    } else if (id.startsWith(ID.go)) {
      const target = Number(id.slice(ID.go.length));
      // Moving forward needs every earlier step to be complete.
      for (let i = 0; i < Math.min(target, steps.length - 1); i++) {
        const problem = blocker(steps[i], progress);
        if (problem) {
          progress.step = i;
          await store.saveProgress(progress);
          return interaction.update(render(guild, settings, progress, problem));
        }
      }
      progress.step = Math.max(0, Math.min(target, steps.length - 1));
    } else if (id === ID.finish) {
      return finish(interaction, settings, member, progress);
    }

    await store.saveProgress(progress);
    return interaction.update(render(guild, settings, progress));
  },
};

async function finish(
  interaction: MessageComponentInteraction,
  settings: OnboardingSettings,
  member: GuildMember,
  progress: store.Progress,
) {
  const steps = stepsFor(settings);
  for (let i = 0; i < steps.length; i++) {
    const problem = blocker(steps[i], progress);
    if (problem) {
      progress.step = i;
      await store.saveProgress(progress);
      return interaction.update(render(member.guild, settings, progress, problem));
    }
  }

  await interaction.deferUpdate();
  try {
    await applyFinalRoles(member, settings, progress.answers);
  } catch (err) {
    const missing = (err as { code?: number }).code === RESTJSONErrorCodes.MissingPermissions;
    console.warn("[onboarding] finishing failed:", (err as Error).message ?? err);
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(PINK)
          .setTitle("Something went wrong")
          .setDescription(
            missing
              ? "I don't have permission to give you your roles. Please let a server admin know."
              : "I couldn't finish setting you up. Please try again in a moment.",
          ),
      ],
      components: [],
    });
  }

  const firstTime = progress.status !== "done";
  progress.status = "done";
  progress.completedAt ??= new Date();
  if (firstTime && settings.welcome.enabled && settings.welcome.when === "complete" && !progress.welcomed) {
    progress.welcomed = await sendWelcome(member, settings).catch(() => false);
  }
  await store.saveProgress(progress);
  scheduleCardRefresh(member.guild);

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(PINK)
        .setTitle(firstTime ? "🎉 You're all set!" : "✅ Saved")
        .setDescription(
          firstTime
            ? `Welcome to **${member.guild.name}**. You can change your answers anytime with the button in this channel.`
            : "Your roles have been updated.",
        ),
    ],
    components: [],
  });
}

/**
 * Keeps the "Start" message in the onboarding channel up to date:
 * posts it, edits it, moves it when the channel changes, and removes it when onboarding steps are off.
 * Returns a problem to show the admin, or null.
 */
export async function syncStartMessage(guild: Guild, settings: OnboardingSettings, enabled: boolean): Promise<string | null> {
  const state = await store.getState(guild.id);
  const wanted = enabled && flowActive(settings) && settings.flow.channelId ? settings.flow.channelId : null;

  const fetchOld = async () => {
    if (!state?.startChannelId || !state.startMessageId) return null;
    const channel = guild.channels.cache.get(state.startChannelId);
    if (!channel?.isTextBased()) return null;
    return channel.messages.fetch(state.startMessageId).catch(() => null);
  };

  const old = await fetchOld();
  if (!wanted) {
    await old?.delete().catch(() => {});
    if (state) await store.saveState(guild.id, null, null);
    return null;
  }

  const channel = postableChannel(guild, wanted);
  if (!channel) return "I can't post in the onboarding channel. Check I can view it, send messages and embed links there.";

  const content = await startCard(guild, settings);
  if (old && old.channelId === channel.id) {
    await old.edit(content);
    return null;
  }
  await old?.delete().catch(() => {});
  const posted = await channel.send(content);
  await store.saveState(guild.id, channel.id, posted.id);
  return null;
}

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The numbered "How it works" list, built from what this server actually asks. */
function howItWorks(settings: OnboardingSettings, unlocks: boolean) {
  const lines: string[] = [];
  const add = (text: string) => lines.push(`${NUMBERS[lines.length]} ${text}`);
  const questions = settings.flow.questions;
  if (settings.flow.rulesEnabled) add("**Read the rules** and click **I agree**");
  if (questions.length) {
    const required = questions.filter((q) => q.required).length;
    const optional = questions.length - required;
    const detail =
      required && optional
        ? `${required} required, ${optional} optional`
        : required
          ? questions.length === 1 ? "required" : "all required"
          : questions.length === 1 ? "optional" : "all optional";
    add(`**Answer ${plural(questions.length, "question")}** · ${detail}`);
  }
  add(`**Click Finish** to ${unlocks ? "unlock the rest of the server" : "get your roles"}`);
  // Rough time: half a minute for rules, a quarter minute per question.
  const minutes = Math.max(1, Math.round(((settings.flow.rulesEnabled ? 30 : 0) + questions.length * 15 + 10) / 60));
  return `${lines.join("\n")}\n\n⏱️ Takes about ${plural(minutes, "minute")}.`;
}

/** The two-part Start message: how onboarding works, then live numbers for the server. */
async function startCard(guild: Guild, settings: OnboardingSettings) {
  const access = await getAccessState(guild.id);
  const unlocks = (settings.gate.enabled && Boolean(settings.gate.roleId)) || access.privateMode;
  const answerRoles = settings.flow.questions.some((q) => q.options.some((o) => o.roleIds.length));
  const verified = settings.access.verifiedRoleId;
  const rewards = [verified ? `<@&${verified}>` : "", answerRoles ? "roles based on your answers" : ""].filter(Boolean).join(", plus ");

  const intro = new EmbedBuilder()
    .setColor(PINK)
    .setTitle(`👋 Welcome to ${guild.name}`.slice(0, 256))
    .setThumbnail(guild.iconURL({ size: 128 }))
    .setDescription(
      [
        settings.flow.intro || "Click Start to get set up.",
        `**How it works**\n${howItWorks(settings, unlocks)}`,
        rewards ? `🎁 **You'll get:** ${rewards}` : "",
        "Already done? Click **Change my answers** any time.",
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4096),
    );

  const counts = await memberCounts(guild, settings);
  const activity = await store.activity(guild.id);
  const number = (n: number) => n.toLocaleString("en-US");
  const stats = new EmbedBuilder()
    .setColor(PINK)
    .setTitle("📊 Server at a glance")
    .addFields(
      { name: "👥 Members", value: number(counts.members), inline: true },
      ...(counts.verified !== null ? [{ name: "✅ Verified", value: number(counts.verified), inline: true }] : []),
      ...(counts.atGate !== null ? [{ name: "🚪 Still at the gate", value: number(counts.atGate), inline: true }] : []),
      { name: "🆕 Joined this week", value: number(activity.joinedLast7Days), inline: true },
      { name: "🎉 Finished this week", value: number(activity.completedLast7Days), inline: true },
    )
    .setFooter({ text: "Updates automatically · Last updated" })
    .setTimestamp(new Date());

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ID.start).setLabel("Start").setEmoji("🚀").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${ID.start}:edit`).setLabel("Change my answers").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [intro, stats], components: [buttons] };
}

const pendingRefresh = new Map<string, NodeJS.Timeout>();

/**
 * Updates the Start card's numbers soon. Many joins or finishes close together become one edit,
 * so a busy server doesn't hit Discord's rate limits.
 */
export function scheduleCardRefresh(guild: Guild, delayMs = 15_000) {
  if (pendingRefresh.has(guild.id)) return;
  pendingRefresh.set(
    guild.id,
    setTimeout(async () => {
      pendingRefresh.delete(guild.id);
      const settings = await store.getActiveSettings(guild.id).catch(() => null);
      const state = await store.getState(guild.id).catch(() => null);
      if (!settings || !state?.startMessageId) return;
      await syncStartMessage(guild, settings, true).catch((err) => console.warn("[onboarding] card refresh failed:", err.message ?? err));
    }, delayMs).unref(),
  );
}

onPrivateJobDone((guild) => scheduleCardRefresh(guild, 1000));
