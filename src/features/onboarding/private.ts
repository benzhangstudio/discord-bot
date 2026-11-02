import { type Guild, PermissionFlagsBits } from "discord.js";
import type { OnboardingCounts, OnboardingSettings, PrivateJob } from "../../shared/onboarding.js";
import { type AccessState, accessSummary, applyAccessNow, withGuildLock } from "./access.js";
import { FixableError } from "./errors.js";
import * as store from "./store.js";

/**
 * Private mode: ordinary channels are only visible to the verified role.
 *
 * Switching it on runs in the background, in a safe order:
 *   1. give the verified role to every current member (and bot) who isn't still at the gate,
 *   2. only then hide ordinary channels from @everyone and show them to the verified role.
 * If step 1 fails for anyone, step 2 never runs, so nobody loses access.
 */

const jobs = new Map<string, PrivateJob>();
export const privateJob = (guildId: string) => jobs.get(guildId) ?? null;
const running = (guildId: string) => ["roles", "channels"].includes(jobs.get(guildId)?.phase ?? "");

/** Called when the job finishes, so the Start card can show new numbers. Set by flow.ts. */
let afterJob: (guild: Guild) => void = () => {};
export const onPrivateJobDone = (fn: (guild: Guild) => void) => {
  afterJob = fn;
};

const lastFetch = new Map<string, number>();

/** Makes sure the member list is cached (role member counts depend on it). At most every 10 minutes per server. */
async function ensureMembers(guild: Guild) {
  if (guild.members.cache.size >= guild.memberCount) return;
  if (Date.now() - (lastFetch.get(guild.id) ?? 0) < 10 * 60 * 1000) return;
  lastFetch.set(guild.id, Date.now());
  await guild.members.fetch().catch(() => {});
}

export async function memberCounts(guild: Guild, settings: OnboardingSettings): Promise<OnboardingCounts> {
  await ensureMembers(guild);
  const verified = settings.access.verifiedRoleId ? guild.roles.cache.get(settings.access.verifiedRoleId) : undefined;
  const gate = settings.gate.enabled && settings.gate.roleId ? guild.roles.cache.get(settings.gate.roleId) : undefined;
  return {
    members: guild.memberCount,
    verified: verified ? verified.members.size : null,
    atGate: gate ? gate.members.size : null,
  };
}

/** Plain-language list of what private mode will do, shown before anything changes. */
export function describePrivateMode(guild: Guild, settings: OnboardingSettings, state: AccessState) {
  const role = settings.access.verifiedRoleId ? guild.roles.cache.get(settings.access.verifiedRoleId) : undefined;
  const gateRole = settings.gate.enabled && settings.gate.roleId ? guild.roles.cache.get(settings.gate.roleId) : undefined;
  const atGate = gateRole?.members.size ?? 0;
  const { byClass } = accessSummary(guild, settings, state);
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const kept = [
    byClass.staff.length && n(byClass.staff.length, "staff channel"),
    byClass.public.length && n(byClass.public.length, "public channel"),
    byClass.newMember.length && n(byClass.newMember.length, "new-member channel"),
    byClass.start.length && "the onboarding channel",
    byClass.ownerPrivate.length && n(byClass.ownerPrivate.length, "already-private channel"),
  ].filter(Boolean);
  return [
    role ? `Use @${role.name} as the Verified role.` : "Create a role called “Verified”.",
    `Give it to everyone already in the server (about ${n(Math.max(guild.memberCount - atGate, 0), "member")}, bots included) so nobody loses access.` +
      (atGate ? ` The ${n(atGate, "member")} still at the gate get it when they finish.` : ""),
    `Then make ${n(byClass.other.length, "channel")} visible only to Verified members.`,
    kept.length ? `Not changed: ${kept.join(", ")}.` : "",
    "From then on, members get Verified when they finish onboarding, and new channels you create are made private too (unless they're already private or in a staff category).",
    "You can turn this off any time. Every channel goes back to exactly how it was.",
  ].filter(Boolean);
}

/** Gives `roleId` to every member without it, except people holding `skipRoleId`. The bot goes first. */
async function grantToEveryone(guild: Guild, roleId: string, skipRoleId: string | null, job: PrivateJob, reason: string) {
  const members = await guild.members.fetch();
  const meId = guild.members.me?.id;
  const targets = [...members.values()]
    .filter((m) => !m.roles.cache.has(roleId) && !(skipRoleId && m.roles.cache.has(skipRoleId)))
    .sort((a, b) => Number(b.id === meId) - Number(a.id === meId));
  job.total = targets.length;
  let failed = 0;
  for (const member of targets) {
    await member.roles.add(roleId, reason).catch(() => failed++);
    job.done++;
  }
  return failed;
}

/**
 * Starts private mode. Creates the Verified role if none is picked and saves it, then runs the rest
 * in the background. Returns the saved settings.
 */
export async function startPrivateMode(
  guild: Guild,
  settings: OnboardingSettings,
  save: (settings: OnboardingSettings) => Promise<void>,
): Promise<OnboardingSettings> {
  if (running(guild.id)) throw new FixableError("This is already running. Wait for it to finish.");
  if (!settings.flow.enabled || !settings.flow.channelId) {
    throw new FixableError("Turn on onboarding steps (with a Start channel) first, so new members have a way to get verified.");
  }
  const me = guild.members.me;
  if (!me?.permissions.has([PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels])) {
    throw new FixableError("I need the Manage Roles and Manage Channels permissions to do this.");
  }

  let role = settings.access.verifiedRoleId ? guild.roles.cache.get(settings.access.verifiedRoleId) : undefined;
  role ??= await guild.roles.create({
    name: "Verified",
    permissions: [],
    mentionable: false,
    reason: "Number One onboarding: members who finished onboarding",
  });
  if (role.position >= me.roles.highest.position) throw new FixableError(`@${role.name} is above my role, so I can't give it out. Move my role higher.`);
  const next: OnboardingSettings = { ...settings, access: { ...settings.access, verifiedRoleId: role.id } };
  await save(next); // saved before the job starts, because the job reads it back

  const job: PrivateJob = { phase: "roles", done: 0, total: 0 };
  jobs.set(guild.id, job);
  const roleId = role.id;
  void (async () => {
    try {
      const gateRole = settings.gate.enabled ? settings.gate.roleId : null;
      const failed = await grantToEveryone(guild, roleId, gateRole, job, "Number One: private mode (keeps access for existing members)");
      if (failed) {
        throw new Error(
          `I couldn't give the Verified role to ${failed} member(s), so I didn't make any channels private. Check my role is above Verified and try again.`,
        );
      }
      job.phase = "channels";
      await withGuildLock(guild.id, async () => {
        await store.saveAccessState(guild.id, { privateMode: true });
        await applyAccessNow(guild, await store.getSettings(guild.id));
      });
      job.phase = "done";
      console.log(`[onboarding] private mode on in ${guild.name} (${guild.id})`);
    } catch (err) {
      job.phase = "failed";
      job.error = (err as Error).message ?? "Something went wrong.";
      console.warn(`[onboarding] private mode failed in ${guild.id}:`, job.error);
    } finally {
      afterJob(guild);
    }
  })();
  return next;
}

/** Turns private mode off and puts every channel's @everyone visibility back as it was. Members keep their roles. */
export async function stopPrivateMode(guild: Guild) {
  if (running(guild.id)) throw new FixableError("Private mode is still being switched on. Wait for it to finish.");
  jobs.delete(guild.id);
  return withGuildLock(guild.id, async () => {
    await store.saveAccessState(guild.id, { privateMode: false });
    return applyAccessNow(guild, await store.getSettings(guild.id));
  });
}
