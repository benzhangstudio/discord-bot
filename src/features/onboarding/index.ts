import { ChannelType, type Guild } from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { roleProblem } from "../../server/bot/roles.js";
import type { BotFeature } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { onboardingFeature } from "../../shared/features.js";
import { type OnboardingSettings, type OnboardingStatus, onboardingSettings } from "../../shared/onboarding.js";
import { parseEmojiInput } from "../reaction-roles/emoji.js";
import { onboardingEvents, startOnboardingTasks } from "./events.js";
import { onboardingComponents, syncStartMessage } from "./flow.js";
import { describeGateSetup, gateCoverage, removeGate, setUpGate } from "./gate.js";
import * as store from "./store.js";

type Req = FastifyRequest<{ Params: { guildId: string } }>;

class FixableError extends Error {}

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/** Checks channels, roles and emojis an admin picked. Throws a plain-language problem. */
async function validate(guild: Guild, userId: string, s: OnboardingSettings) {
  const checkChannel = (id: string | null, what: string) => {
    if (!id) return;
    const channel = guild.channels.cache.get(id);
    if (!channel || !TEXT_TYPES.has(channel.type)) throw new FixableError(`The ${what} channel no longer exists. Pick another.`);
  };
  checkChannel(s.welcome.channelId, "welcome");
  checkChannel(s.goodbye.channelId, "goodbye");
  checkChannel(s.flow.channelId, "onboarding");
  if (s.flow.enabled && (s.flow.rulesEnabled || s.flow.questions.length) && !s.flow.channelId) {
    throw new FixableError("Pick a channel for the onboarding Start button.");
  }
  if (s.flow.rulesEnabled && !s.flow.rules.trim()) throw new FixableError("Write your rules, or turn the rules step off.");

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new FixableError("You're no longer a member of this server.");
  const rank = { position: member.roles.highest.position, isOwner: guild.ownerId === member.id };
  const checkRole = (id: string, where: string) => {
    const problem = roleProblem(guild, id, rank);
    if (problem) throw new FixableError(`${where}: ${problem.replace(/\*\*/g, "")}`);
  };
  s.joinRoles.forEach((id) => checkRole(id, "Join roles"));
  s.botRoles.forEach((id) => checkRole(id, "Bot roles"));
  if (s.gate.roleId) checkRole(s.gate.roleId, "New member role");

  const questionIds = new Set<string>();
  for (const q of s.flow.questions) {
    if (questionIds.has(q.id)) throw new FixableError("Two questions share the same ID. Reload the page and try again.");
    questionIds.add(q.id);
    const optionIds = new Set<string>();
    for (const o of q.options) {
      if (optionIds.has(o.id)) throw new FixableError(`“${q.title}” has a duplicate answer. Reload the page and try again.`);
      optionIds.add(o.id);
      o.roleIds.forEach((id) => checkRole(id, `“${q.title}” → “${o.label}”`));
      if (o.emoji) {
        const emoji = parseEmojiInput(o.emoji, guild);
        if ("error" in emoji) throw new FixableError(`“${q.title}” → “${o.label}”: ${emoji.error}`);
        o.emoji = emoji.display;
      }
    }
  }
  if (s.gate.enabled && !s.gate.roleId) throw new FixableError("Choose a New member role, or use “Set it up for me”.");
}

async function status(guild: Guild, settings: OnboardingSettings): Promise<OnboardingStatus> {
  const state = await store.getState(guild.id);
  const coverage = gateCoverage(guild, settings);
  return {
    startMessageUrl:
      state?.startChannelId && state.startMessageId
        ? `https://discord.com/channels/${guild.id}/${state.startChannelId}/${state.startMessageId}`
        : null,
    hiddenChannels: coverage.hidden,
    totalChannels: coverage.total,
    communityOnboarding: guild.features.includes("COMMUNITY"),
    activity: await store.activity(guild.id),
  };
}

async function respond(guild: Guild, settings: OnboardingSettings, warnings: string[] = []) {
  return { settings, status: await status(guild, settings), gatePlan: describeGateSetup(guild, settings), warnings };
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof FixableError) return reply.code(400).send({ error: err.message });
    const message = (err as Error).message ?? "";
    if (message.startsWith("I need")) return reply.code(400).send({ error: message });
    throw err;
  }
}

export const onboarding: BotFeature = {
  info: onboardingFeature,
  events: onboardingEvents,
  components: [onboardingComponents],
  setup: startOnboardingTasks,

  // Posting or removing the Start message follows the feature's on/off switch.
  async onToggle(guildId, enabled) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await syncStartMessage(guild, await store.getSettings(guildId), enabled);
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/onboarding", async (request: Req) => {
      const guild = guildOf(request);
      return respond(guild, await store.getSettings(guild.id));
    });

    api.put("/api/guilds/:guildId/onboarding", async (request: Req, reply) =>
      guarded(reply, async () => {
        if (onboardingFeature.workInProgress) throw new FixableError("Member onboarding is still being worked on and can't be changed yet.");
        const guild = guildOf(request);
        const parsed = onboardingSettings.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
        const settings = parsed.data;
        await validate(guild, request.session!.userId, settings);

        const state = await getFeatureState(guild.id, onboardingFeature);
        await saveFeatureState(guild.id, onboardingFeature, { enabled: state.enabled, settings }, request.session!.userId);
        const problem = await syncStartMessage(guild, settings, state.enabled);
        return respond(guild, settings, problem ? [problem] : []);
      }),
    );

    api.post("/api/guilds/:guildId/onboarding/gate/setup", async (request: Req, reply) =>
      guarded(reply, async () => {
        if (onboardingFeature.workInProgress) throw new FixableError("Member onboarding is still being worked on and can't be changed yet.");
        const guild = guildOf(request);
        const state = await getFeatureState(guild.id, onboardingFeature);
        if (!state.enabled) throw new FixableError("Turn on Member onboarding first.");
        const { settings, skipped } = await setUpGate(guild, state.settings as OnboardingSettings);
        await saveFeatureState(guild.id, onboardingFeature, { enabled: true, settings }, request.session!.userId);
        const problem = await syncStartMessage(guild, settings, true);
        const warnings = [
          ...(skipped.length ? [`I couldn't hide ${skipped.length} channel(s) because I can't manage them: ${skipped.slice(0, 10).join(", ")}`] : []),
          ...(problem ? [problem] : []),
        ];
        return respond(guild, settings, warnings);
      }),
    );

    api.post("/api/guilds/:guildId/onboarding/gate/remove", async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const state = await getFeatureState(guild.id, onboardingFeature);
        const { settings, changed } = await removeGate(guild, state.settings as OnboardingSettings);
        await saveFeatureState(guild.id, onboardingFeature, { enabled: state.enabled, settings }, request.session!.userId);
        return respond(guild, settings, [`Channels are visible to new members again (${changed} updated).`]);
      }),
    );
  },
};
