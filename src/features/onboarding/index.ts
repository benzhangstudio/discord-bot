import { ChannelType, type Guild } from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { roleProblem } from "../../server/bot/roles.js";
import type { BotFeature } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { onboardingFeature } from "../../shared/features.js";
import { type OnboardingSettings, type OnboardingStatus, onboardingSettings } from "../../shared/onboarding.js";
import { parseEmojiInput } from "../reaction-roles/emoji.js";
import { type AccessState, accessSummary, applyAccessNow, getAccessState, syncAccess, withGuildLock } from "./access.js";
import { FixableError } from "./errors.js";
import { onboardingEvents, releaseGatedMembers, startOnboardingTasks } from "./events.js";
import { onboardingComponents, syncStartMessage } from "./flow.js";
import { describeGateSetup, gateLeaks, setUpGate } from "./gate.js";
import { describePrivateMode, memberCounts, privateJob, startPrivateMode, stopPrivateMode } from "./private.js";
import * as store from "./store.js";

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const isOwner = (guild: Guild, userId: string) => guild.ownerId === userId;

/** Checks channels, roles and emojis an admin picked. Throws a plain-language problem. */
async function validate(guild: Guild, userId: string, s: OnboardingSettings, access: AccessState) {
  const checkChannel = (id: string | null, what: string) => {
    if (!id) return;
    const channel = guild.channels.cache.get(id);
    if (!channel || !TEXT_TYPES.has(channel.type)) throw new FixableError(`The ${what} channel no longer exists. Pick another.`);
  };
  checkChannel(s.welcome.channelId, "welcome");
  checkChannel(s.goodbye.channelId, "goodbye");
  checkChannel(s.flow.channelId, "onboarding");
  if (s.flow.enabled && !s.flow.channelId) throw new FixableError("Pick a channel for the onboarding Start button.");
  if (s.gate.enabled && !s.flow.enabled) {
    throw new FixableError("The access gate needs onboarding steps on, or new members can't get in. Turn the gate off first.");
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

  // Channel access
  const a = s.access;
  const name = (id: string) => guild.channels.cache.get(id)?.name ?? "a deleted channel";
  for (const id of a.staffCategoryIds) {
    if (guild.channels.cache.get(id)?.type !== ChannelType.GuildCategory) throw new FixableError("A staff category no longer exists. Remove it and save again.");
  }
  const inStaff = (id: string) => {
    const channel = guild.channels.cache.get(id);
    return a.staffCategoryIds.includes(id) || Boolean(channel?.parentId && a.staffCategoryIds.includes(channel.parentId));
  };
  for (const id of [...a.publicChannelIds, ...a.newMemberChannelIds]) {
    const channel = guild.channels.cache.get(id);
    if (!channel || channel.isThread()) throw new FixableError("One of the picked channels no longer exists. Remove it and save again.");
    if (inStaff(id)) throw new FixableError(`#${name(id)} is in a staff category, which Number One never changes. Remove it from the list.`);
  }
  const both = a.publicChannelIds.find((id) => a.newMemberChannelIds.includes(id));
  if (both) throw new FixableError(`#${name(both)} can't be both public and new-member-only.`);
  if (a.newMemberChannelIds.length && !(s.gate.enabled && s.gate.roleId)) {
    throw new FixableError("New-member-only channels need the access gate, which gives new members their New member role. Set up the gate first.");
  }
  if (a.verifiedRoleId) {
    checkRole(a.verifiedRoleId, "Verified role");
    if (a.verifiedRoleId === s.gate.roleId) throw new FixableError("The Verified role and the New member role must be different roles.");
    if (s.joinRoles.includes(a.verifiedRoleId)) {
      throw new FixableError("Don't give the Verified role as a join role. Members get it when they finish onboarding.");
    }
  }
  if (access.privateMode) {
    if (!a.verifiedRoleId) throw new FixableError("Private mode is on, so it needs a Verified role. Turn private mode off first.");
    if (!s.flow.enabled) throw new FixableError("Private mode is on, so new members need onboarding steps to get verified. Turn private mode off first.");
  }
}

async function status(guild: Guild, settings: OnboardingSettings, access: AccessState): Promise<OnboardingStatus> {
  const state = await store.getState(guild.id);
  const summary = accessSummary(guild, settings, access);
  return {
    startMessageUrl:
      state?.startChannelId && state.startMessageId
        ? `https://discord.com/channels/${guild.id}/${state.startChannelId}/${state.startMessageId}`
        : null,
    hiddenChannels: summary.hiddenFromGate,
    totalChannels: summary.byClass.other.length,
    communityOnboarding: guild.features.includes("COMMUNITY"),
    activity: await store.activity(guild.id),
    counts: await memberCounts(guild, settings),
    privateMode: access.privateMode,
    privateChannels: summary.privateNow,
    privateJob: privateJob(guild.id),
  };
}

async function respond(guild: Guild, settings: OnboardingSettings, userId: string, warnings: string[] = []) {
  const access = await getAccessState(guild.id);
  const leaks = gateLeaks(guild, settings, access);
  if (leaks.length) {
    warnings = [
      ...warnings,
      `New members can still see ${leaks.slice(0, 10).join(", ")} because a join role is allowed in. ` +
        "Remove that role's View Channel permission there, or take it out of Join roles.",
    ];
  }
  return {
    settings,
    status: await status(guild, settings, access),
    gatePlan: describeGateSetup(guild, settings, access),
    privatePlan: describePrivateMode(guild, settings, access),
    /** Channel access and private mode can only be changed by the server owner. */
    canManageAccess: isOwner(guild, userId),
    warnings,
  };
}

const skippedWarning = (skipped: string[]) =>
  skipped.length ? [`I couldn't change ${skipped.length} channel(s) because I can't manage them there: ${skipped.slice(0, 10).join(", ")}`] : [];

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

function requireOwner(guild: Guild, userId: string) {
  if (!isOwner(guild, userId)) throw new FixableError("Only the server owner can change channel access.");
}

export const onboarding: BotFeature = {
  info: onboardingFeature,
  events: onboardingEvents,
  components: [onboardingComponents],
  setup: startOnboardingTasks,

  // The Start message and channel access follow the feature's on/off switch. Switching off also turns
  // private mode off and lets anyone still behind the gate in, since there's no Start button left for them.
  async onToggle(guildId, enabled) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const settings = await store.getSettings(guildId);
    await syncStartMessage(guild, settings, enabled);
    if (enabled) {
      await syncAccess(guild);
      return;
    }
    if ((await getAccessState(guildId)).privateMode) await stopPrivateMode(guild).catch((err) => console.warn("[onboarding]", err.message));
    await releaseGatedMembers(guild, settings, "Member onboarding was switched off");
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
    const userOf = (request: Req) => request.session!.userId;

    api.get("/api/guilds/:guildId/onboarding", async (request: Req) => {
      const guild = guildOf(request);
      return respond(guild, await store.getSettings(guild.id), userOf(request));
    });

    api.put("/api/guilds/:guildId/onboarding", async (request: Req, reply) =>
      guarded(reply, async () => {
        if (onboardingFeature.workInProgress) throw new FixableError("Member onboarding is still being worked on and can't be changed yet.");
        const guild = guildOf(request);
        const parsed = onboardingSettings.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
        const settings = store.normalize(parsed.data);
        const state = await getFeatureState(guild.id, onboardingFeature);
        const before = store.normalize(state.settings as OnboardingSettings);
        if (JSON.stringify(settings.access) !== JSON.stringify(before.access)) requireOwner(guild, userOf(request));
        await validate(guild, userOf(request), settings, await getAccessState(guild.id));

        const result = await withGuildLock(guild.id, async () => {
          await saveFeatureState(guild.id, onboardingFeature, { enabled: state.enabled, settings }, userOf(request));
          return state.enabled ? applyAccessNow(guild, settings) : null;
        });
        const problem = await syncStartMessage(guild, settings, state.enabled);
        return respond(guild, settings, userOf(request), [...skippedWarning(result?.skipped ?? []), ...(problem ? [problem] : [])]);
      }),
    );

    api.post("/api/guilds/:guildId/onboarding/gate/setup", async (request: Req, reply) =>
      guarded(reply, async () => {
        if (onboardingFeature.workInProgress) throw new FixableError("Member onboarding is still being worked on and can't be changed yet.");
        const guild = guildOf(request);
        const state = await getFeatureState(guild.id, onboardingFeature);
        if (!state.enabled) throw new FixableError("Turn on Member onboarding first.");
        const { settings, result } = await withGuildLock(guild.id, async () => {
          const settings = store.normalize(await setUpGate(guild, state.settings as OnboardingSettings));
          await saveFeatureState(guild.id, onboardingFeature, { enabled: true, settings }, userOf(request));
          return { settings, result: await applyAccessNow(guild, settings) };
        });
        const problem = await syncStartMessage(guild, settings, true);
        return respond(guild, settings, userOf(request), [...skippedWarning(result.skipped), ...(problem ? [problem] : [])]);
      }),
    );

    api.post("/api/guilds/:guildId/onboarding/gate/remove", async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const state = await getFeatureState(guild.id, onboardingFeature);
        const current = state.settings as OnboardingSettings;
        if (current.access.newMemberChannelIds.length) {
          throw new FixableError("New-member-only channels depend on the gate. Clear that list and save first.");
        }
        const settings: OnboardingSettings = { ...current, gate: { ...current.gate, enabled: false } };
        const result = await withGuildLock(guild.id, async () => {
          await saveFeatureState(guild.id, onboardingFeature, { enabled: state.enabled, settings }, userOf(request));
          return applyAccessNow(guild, settings);
        });
        await syncStartMessage(guild, settings, state.enabled);
        return respond(guild, settings, userOf(request), [
          `Channels are visible to new members again (${result.changed} updated).`,
          ...skippedWarning(result.skipped),
        ]);
      }),
    );

    api.post("/api/guilds/:guildId/onboarding/private/setup", async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        requireOwner(guild, userOf(request));
        const state = await getFeatureState(guild.id, onboardingFeature);
        if (!state.enabled) throw new FixableError("Turn on Member onboarding first.");
        if ((await getAccessState(guild.id)).privateMode) throw new FixableError("Private mode is already on.");
        const current = state.settings as OnboardingSettings;
        await validate(guild, userOf(request), current, { privateMode: false, managed: {} });
        const settings = await startPrivateMode(guild, current, (next) =>
          saveFeatureState(guild.id, onboardingFeature, { enabled: true, settings: next }, userOf(request)),
        );
        return respond(guild, settings, userOf(request));
      }),
    );

    api.post("/api/guilds/:guildId/onboarding/private/remove", async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        requireOwner(guild, userOf(request));
        const result = await stopPrivateMode(guild);
        const settings = await store.getSettings(guild.id);
        await syncStartMessage(guild, settings, (await getFeatureState(guild.id, onboardingFeature)).enabled);
        return respond(guild, settings, userOf(request), [
          `Private mode is off. ${result.changed} channel(s) are back to how they were.`,
          ...skippedWarning(result.skipped),
        ]);
      }),
    );
  },
};
