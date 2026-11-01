import { type Guild, type GuildMember, RESTJSONErrorCodes } from "discord.js";
import { isDiscordError, roleProblem } from "./message.js";
import * as store from "./store.js";
import type { ReactionRoleConfig, ReactionRoleEntry } from "./store.js";

/**
 * The rules for what picking a role does, shared by reactions, buttons and the dropdown.
 * Every change for one member in one server runs in order (see `inOrder`), and anything that
 * depends on the member's other roles uses freshly fetched data.
 */

const log = (...args: unknown[]) => console.warn("[reaction-roles]", ...args);

const queues = new Map<string, Promise<unknown>>();
/** Runs one member's role changes one at a time, so quick clicks can't race each other. */
export function inOrder<T>(guildId: string, userId: string, task: () => Promise<T>): Promise<T> {
  const key = `${guildId}:${userId}`;
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/** What happened, for the member's private confirmation. */
export interface Outcome {
  added: string[];
  removed: string[];
  /** Why nothing changed, in plain words (e.g. not allowed, limit reached). */
  denied?: string;
  /** When the roles just added will be taken away again (temporary roles), as a timestamp. */
  expiresAt?: number;
}

const nothing = (denied?: string): Outcome => ({ added: [], removed: [], denied });

/** Checks the "who can use this" rules. Returns a reason when the member can't. */
export function accessProblem(member: GuildMember, config: ReactionRoleConfig): string | null {
  const { allowedRoles, ignoredRoles } = config.options;
  const has = (id: string) => member.roles.cache.has(id);
  if (ignoredRoles.some(has)) return "You can't use this role menu.";
  const allowed = allowedRoles.filter((id) => member.guild.roles.cache.has(id));
  if (allowed.length && !allowed.some(has)) {
    const names = allowed.map((id) => `@${member.guild.roles.cache.get(id)!.name}`).slice(0, 5);
    return `You need ${names.length > 1 ? "one of these roles" : "this role"} to use this: ${names.join(", ")}.`;
  }
  return null;
}

/** Fresh member data, so decisions never rely on a cache that's a moment behind. */
async function fresh(member: GuildMember) {
  return (await member.guild.members.fetch({ user: member.id, force: true }).catch(() => null)) ?? member;
}

/** Roles from this message the bot can actually hand out. */
function usableRoles(guild: Guild, config: ReactionRoleConfig) {
  return new Set(config.entries.map((e) => e.roleId).filter((id) => !roleProblem(guild, id)));
}

/**
 * Moves the member to a new set of roles in one change. Only roles from this message are touched.
 * Returns what changed.
 */
async function applyRoles(member: GuildMember, config: ReactionRoleConfig, add: string[], remove: string[]): Promise<Outcome> {
  const usable = usableRoles(member.guild, config);
  const toAdd = add.filter((id) => usable.has(id) && !member.roles.cache.has(id));
  const toRemove = remove.filter((id) => usable.has(id) && member.roles.cache.has(id));
  if (!toAdd.length && !toRemove.length) {
    const blocked = [...add, ...remove].find((id) => !usable.has(id));
    return nothing(blocked ? "That role can't be given out right now. Let a server admin know." : undefined);
  }
  try {
    if (toAdd.length + toRemove.length === 1) {
      // One role: the simple add/remove calls never touch any other role.
      if (toAdd.length) await member.roles.add(toAdd[0], "Reaction roles");
      else await member.roles.remove(toRemove[0], "Reaction roles");
    } else {
      const next = [...member.roles.cache.keys()].filter((id) => id !== member.guild.id && !toRemove.includes(id));
      await member.roles.set([...next, ...toAdd], "Reaction roles");
    }
    const expiresAt = await afterChange(member, config, toAdd, toRemove);
    return { added: toAdd, removed: toRemove, expiresAt };
  } catch (err) {
    if (isDiscordError(err, RESTJSONErrorCodes.MissingPermissions)) {
      log(`missing permission to change roles for ${member.id} in ${member.guild.name} (${member.guild.id})`);
      return nothing("I'm not allowed to change your roles. Let a server admin know.");
    }
    if (!isDiscordError(err, RESTJSONErrorCodes.UnknownRole, RESTJSONErrorCodes.UnknownMember)) log("role update failed:", err);
    return nothing("Something went wrong changing your roles. Please try again.");
  }
}

/**
 * Book-keeping after a successful change: usage stats, and countdowns for temporary roles.
 * Never blocks the change itself if it fails. Returns when added roles expire, if they do.
 */
async function afterChange(member: GuildMember, config: ReactionRoleConfig, added: string[], removed: string[]) {
  await store.recordUse(config.messageId, added, removed).catch((err) => log("couldn't save stats:", err));
  try {
    if (removed.length) await store.clearTimers(member.guild.id, member.id, removed);
    const minutes = config.options.tempMinutes;
    if (!minutes || !added.length) return undefined;
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    for (const roleId of added) {
      await store.setTimer({
        guildId: member.guild.id,
        userId: member.id,
        roleId,
        messageId: config.messageId,
        channelId: config.channelId,
        expiresAt,
      });
    }
    return expiresAt.getTime();
  } catch (err) {
    log("couldn't save a temporary role timer:", err);
    return undefined;
  }
}

const heldFrom = (member: GuildMember, config: ReactionRoleConfig) =>
  config.entries.map((e) => e.roleId).filter((id) => member.roles.cache.has(id));

/**
 * A member picked (selected = true) or un-picked (selected = false) one role, by reacting or un-reacting.
 * Applies the message's mode, limits and access rules.
 */
export async function choose(
  memberIn: GuildMember,
  config: ReactionRoleConfig,
  entry: ReactionRoleEntry,
  selected: boolean,
  isFresh = false,
): Promise<Outcome> {
  const member = isFresh ? memberIn : await fresh(memberIn);
  const denied = accessProblem(member, config);
  if (denied) return nothing(denied);
  const role = entry.roleId;

  switch (config.mode) {
    case "verify":
      return selected ? applyRoles(member, config, [role], []) : nothing();
    case "drop":
      return selected ? applyRoles(member, config, [], [role]) : nothing();
    case "reversed":
      return selected ? applyRoles(member, config, [], [role]) : applyRoles(member, config, [role], []);
    case "binding": {
      if (!selected) return nothing();
      const held = heldFrom(member, config);
      if (held.includes(role)) return nothing();
      const limit = config.options.maxRoles || 1;
      if (held.length >= limit) return nothing("You've already made your choice here, and it can't be changed.");
      return applyRoles(member, config, [role], []);
    }
    case "unique": {
      if (!selected) return applyRoles(member, config, [], [role]);
      const others = heldFrom(member, config).filter((id) => id !== role);
      return applyRoles(member, config, [role], others);
    }
    default: {
      if (!selected) return applyRoles(member, config, [], [role]);
      const max = config.options.maxRoles;
      if (!max) return applyRoles(member, config, [role], []);
      const held = heldFrom(member, config).filter((id) => id !== role);
      if (held.length >= max) return nothing(`You can pick up to ${max} role${max === 1 ? "" : "s"} here. Remove one first.`);
      return applyRoles(member, config, [role], []);
    }
  }
}

/**
 * A button click, or a reaction on a message that clears reactions after use: it toggles.
 * Having the role means this click is about removing it, except where the mode says otherwise.
 */
export async function toggle(memberIn: GuildMember, config: ReactionRoleConfig, entry: ReactionRoleEntry): Promise<Outcome> {
  const member = await fresh(memberIn);
  const denied = accessProblem(member, config);
  if (denied) return nothing(denied);
  const has = member.roles.cache.has(entry.roleId);
  switch (config.mode) {
    case "verify":
      return has ? nothing("You already have this role.") : choose(member, config, entry, true, true);
    case "drop":
      return has ? choose(member, config, entry, true, true) : nothing("You don't have this role.");
    case "binding":
      return has ? nothing("Your choice here is permanent.") : choose(member, config, entry, true, true);
    case "reversed":
      return choose(member, config, entry, !has, true);
    default:
      return choose(member, config, entry, !has, true);
  }
}

/** The member's choice from the dropdown: `picked` is every role they have selected now. */
export async function pickFromMenu(memberIn: GuildMember, config: ReactionRoleConfig, picked: string[]): Promise<Outcome> {
  const member = await fresh(memberIn);
  const denied = accessProblem(member, config);
  if (denied) return nothing(denied);
  const ids = new Set(config.entries.map((e) => e.roleId));
  const chosen = [...new Set(picked)].filter((id) => ids.has(id));
  const held = heldFrom(member, config);

  switch (config.mode) {
    case "verify":
      return applyRoles(member, config, chosen, []);
    case "drop":
      return applyRoles(member, config, [], chosen);
    case "binding": {
      if (held.length) return nothing("You've already made your choice here, and it can't be changed.");
      const limit = config.options.maxRoles || 1;
      return applyRoles(member, config, chosen.slice(0, limit), []);
    }
    case "unique":
      return applyRoles(member, config, chosen.slice(0, 1), held.filter((id) => !chosen.slice(0, 1).includes(id)));
    default: {
      const max = config.options.maxRoles;
      const keep = max ? chosen.slice(0, max) : chosen;
      return applyRoles(member, config, keep, held.filter((id) => !keep.includes(id)));
    }
  }
}

/** Plain-language summary for the member's private reply. */
export function describeOutcome(o: Outcome, empty = "No changes."): string {
  if (o.denied) return o.denied;
  const parts: string[] = [];
  if (o.added.length) {
    const until = o.expiresAt ? ` until <t:${Math.floor(o.expiresAt / 1000)}:f> (<t:${Math.floor(o.expiresAt / 1000)}:R>)` : "";
    parts.push(`✅ Added ${o.added.map((id) => `<@&${id}>`).join(", ")}${until}`);
  }
  if (o.removed.length) parts.push(`➖ Removed ${o.removed.map((id) => `<@&${id}>`).join(", ")}`);
  return parts.join("\n") || empty;
}
