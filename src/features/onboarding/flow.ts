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
import { PINK, postableChannel, sendWelcome } from "./messages.js";
import { applyFinalRoles } from "./roles.js";
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

/** Builds the private message for the member's current step. */
function render(guild: Guild, settings: OnboardingSettings, progress: store.Progress, note?: string) {
  const steps = stepsFor(settings);
  const index = Math.min(Math.max(progress.step, 0), steps.length - 1);
  const step = steps[index];
  const embed = new EmbedBuilder().setColor(PINK);
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  const nav = new ActionRowBuilder<ButtonBuilder>();
  if (index > 0) nav.addComponents(new ButtonBuilder().setCustomId(`${ID.go}${index - 1}`).setLabel("Back").setStyle(ButtonStyle.Secondary));

  if (step.kind === "rules") {
    embed.setTitle(`📜 ${guild.name} rules`).setDescription(settings.flow.rules || "Be kind and respectful.");
    nav.addComponents(
      progress.rulesAccepted
        ? new ButtonBuilder().setCustomId(`${ID.go}${index + 1}`).setLabel("Next").setStyle(ButtonStyle.Primary)
        : new ButtonBuilder().setCustomId(ID.agree).setLabel("I agree").setStyle(ButtonStyle.Success),
    );
  } else if (step.kind === "question") {
    const q = step.question;
    const chosen = progress.answers[q.id] ?? [];
    embed
      .setTitle(q.title)
      .setDescription(
        [q.description, q.multiple ? "_Pick as many as you like._" : "_Pick one._", q.required ? "" : "_Optional._"]
          .filter(Boolean)
          .join("\n"),
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
    embed
      .setTitle("Almost done!")
      .setDescription(
        settings.flow.questions.length
          ? `Here's what you picked. Go back to change anything.\n\n${answerSummary(settings, progress)}`
          : "You're ready to go. Click Finish to get started.",
      );
    nav.addComponents(new ButtonBuilder().setCustomId(ID.finish).setLabel(progress.status === "done" ? "Save" : "Finish").setStyle(ButtonStyle.Success));
  }

  embed.setFooter({ text: `Step ${index + 1} of ${steps.length}${note ? `  •  ${note}` : ""}` });
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

  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setTitle(`Welcome to ${guild.name}`)
    .setDescription(settings.flow.intro || "Click Start to get set up.");
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ID.start).setLabel("Start").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${ID.start}:edit`).setLabel("Change my answers").setStyle(ButtonStyle.Secondary),
  );
  const content = { embeds: [embed], components: [buttons] };

  if (old && old.channelId === channel.id) {
    await old.edit(content);
    return null;
  }
  await old?.delete().catch(() => {});
  const posted = await channel.send(content);
  await store.saveState(guild.id, channel.id, posted.id);
  return null;
}
