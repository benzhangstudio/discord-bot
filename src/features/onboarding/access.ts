import { type Guild, type GuildBasedChannel, OverwriteType, PermissionFlagsBits } from "discord.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";
import * as store from "./store.js";

/**
 * Channel access: decides who can see each channel and makes Discord match.
 *
 * Every channel falls into one class:
 *   staff        in a staff category (or is one): never touched
 *   public       picked as public (or inside a picked category): everyone can see it
 *   newMember    picked as new-member-only: only members still onboarding can see it
 *   start        the onboarding channel and its category: new members can always see it
 *   ownerPrivate already hidden from @everyone by the server's admins: left alone, so nothing private is exposed
 *   other        everything else: hidden from new members while the gate is on, and only visible to the
 *                verified role while private mode is on
 *
 * Only the "View Channel" permission is changed, and only for @everyone, the New member role and the
 * verified role. Before @everyone's setting is changed, what it was is recorded, so switching things
 * off puts every channel back exactly as it was.
 */

const VIEW = PermissionFlagsBits.ViewChannel;

/** allow, deny, or not set. */
type Bit = boolean | null;
type Original = "allow" | "deny" | "none";
export type ChannelClass = "staff" | "start" | "public" | "newMember" | "ownerPrivate" | "other";
type Overwritable = Extract<GuildBasedChannel, { permissionOverwrites: unknown }>;

export interface AccessState {
  privateMode: boolean;
  managed: Record<string, Original>;
}

const hasOverwrites = (c: GuildBasedChannel): c is Overwritable => !c.isThread() && "permissionOverwrites" in c;

/** Every channel access applies to (no threads; they follow their parent). */
export const accessChannels = (guild: Guild) => [...guild.channels.cache.values()].filter(hasOverwrites);

export function viewBit(channel: Overwritable, id: string): Bit {
  const o = channel.permissionOverwrites.cache.get(id);
  if (o?.allow.has(VIEW)) return true;
  if (o?.deny.has(VIEW)) return false;
  return null;
}

const toOriginal = (b: Bit): Original => (b === true ? "allow" : b === false ? "deny" : "none");
const fromOriginal = (o: Original): Bit => (o === "allow" ? true : o === "deny" ? false : null);

/** The onboarding channel and the category it sits in. */
export function startArea(guild: Guild, startChannelId: string | null) {
  const channel = startChannelId ? guild.channels.cache.get(startChannelId) : undefined;
  return new Set([startChannelId, channel?.parentId].filter((id): id is string => Boolean(id)));
}

export async function getAccessState(guildId: string): Promise<AccessState> {
  const row = await store.getState(guildId);
  return { privateMode: Boolean(row?.privateMode), managed: { ...(row?.managedChannels ?? {}) } };
}

export function classify(channel: Overwritable, settings: OnboardingSettings, state: AccessState): ChannelClass {
  const a = settings.access;
  const parent = channel.parentId;
  if (a.staffCategoryIds.includes(channel.id) || (parent && a.staffCategoryIds.includes(parent))) return "staff";
  // A channel picked directly beats the category it sits in.
  const listed = (ids: string[]) => (ids.includes(channel.id) ? 2 : parent && ids.includes(parent) ? 1 : 0);
  const pub = listed(a.publicChannelIds);
  const fresh = listed(a.newMemberChannelIds);
  if (pub || fresh) return pub >= fresh ? "public" : "newMember";
  if (startArea(channel.guild, settings.flow.channelId).has(channel.id)) return "start";
  if (viewBit(channel, channel.guild.id) === false && !(channel.id in state.managed)) return "ownerPrivate";
  return "other";
}

/** What each role's "View Channel" should be. `undefined` = leave as is, "restore" = put back what it was. */
interface Wanted {
  everyone?: Bit | "restore";
  gate?: Bit;
  verified?: Bit;
}

function wanted(cls: ChannelClass, settings: OnboardingSettings, state: AccessState): Wanted {
  switch (cls) {
    case "public":
      return { everyone: true, gate: null, verified: null };
    case "newMember":
      return { everyone: false, gate: true, verified: null };
    case "start":
      return { gate: true };
    case "other":
      return {
        everyone: state.privateMode ? false : "restore",
        gate: settings.gate.enabled ? false : null,
        verified: state.privateMode ? true : null,
      };
    default:
      return {};
  }
}

function botCanEdit(channel: Overwritable) {
  const me = channel.guild.members.me;
  return Boolean(me && channel.permissionsFor(me)?.has([VIEW, PermissionFlagsBits.ManageRoles]));
}

/** Sets one role's View Channel on one channel. Removes the whole overwrite when nothing else is left in it. */
async function setView(channel: Overwritable, roleId: string, bit: Bit, reason: string) {
  const current = channel.permissionOverwrites.cache.get(roleId);
  if (bit === null && current && (current.allow.bitfield | current.deny.bitfield) === VIEW) {
    await channel.permissionOverwrites.delete(roleId, reason);
    return;
  }
  await channel.permissionOverwrites.edit(roleId, { ViewChannel: bit }, { reason, type: OverwriteType.Role });
}

export interface ApplyResult {
  changed: number;
  /** Channels the bot couldn't change (missing permissions there). */
  skipped: string[];
}

/**
 * Makes every channel (or just `only`) match the settings. Safe to run again and again: it only changes
 * what differs. Callers must hold the server's lock (see withGuildLock).
 */
export async function applyAccessNow(guild: Guild, settings: OnboardingSettings, only?: GuildBasedChannel[]): Promise<ApplyResult> {
  const state = await getAccessState(guild.id);
  const gateRole = settings.gate.roleId && guild.roles.cache.has(settings.gate.roleId) ? settings.gate.roleId : null;
  const verifiedRole =
    settings.access.verifiedRoleId && guild.roles.cache.has(settings.access.verifiedRoleId) ? settings.access.verifiedRoleId : null;
  const reason = "Number One onboarding: channel access";
  const result: ApplyResult = { changed: 0, skipped: [] };
  let managedChanged = false;

  // Forget channels that no longer exist.
  if (!only) {
    for (const id of Object.keys(state.managed)) {
      if (!guild.channels.cache.has(id)) {
        delete state.managed[id];
        managedChanged = true;
      }
    }
  }

  const channels = only ? only.filter(hasOverwrites) : accessChannels(guild);
  for (const channel of channels) {
    const want = wanted(classify(channel, settings, state), settings, state);
    const edits: [string, Bit][] = [];

    if (want.everyone !== undefined) {
      const now = viewBit(channel, guild.id);
      if (want.everyone === "restore") {
        if (channel.id in state.managed) {
          const before = fromOriginal(state.managed[channel.id]);
          if (before !== now) edits.push([guild.id, before]);
          delete state.managed[channel.id];
          managedChanged = true;
        }
      } else if (want.everyone !== now) {
        if (!(channel.id in state.managed)) {
          state.managed[channel.id] = toOriginal(now);
          managedChanged = true;
        }
        edits.push([guild.id, want.everyone]);
      }
    }
    if (gateRole && want.gate !== undefined && viewBit(channel, gateRole) !== want.gate) edits.push([gateRole, want.gate]);
    if (verifiedRole && want.verified !== undefined && viewBit(channel, verifiedRole) !== want.verified) {
      edits.push([verifiedRole, want.verified]);
    }
    if (!edits.length) continue;

    if (!botCanEdit(channel)) {
      result.skipped.push(`#${channel.name}`);
      continue;
    }
    try {
      for (const [id, bit] of edits) await setView(channel, id, bit, reason);
      result.changed++;
    } catch {
      result.skipped.push(`#${channel.name}`);
    }
  }

  if (managedChanged) await store.saveAccessState(guild.id, { managedChannels: state.managed });
  return result;
}

/** Counts used on the dashboard and in plans. */
export function accessSummary(guild: Guild, settings: OnboardingSettings, state: AccessState) {
  const byClass: Record<ChannelClass, Overwritable[]> = { staff: [], start: [], public: [], newMember: [], ownerPrivate: [], other: [] };
  for (const c of accessChannels(guild)) byClass[classify(c, settings, state)].push(c);
  const gateRole = settings.gate.roleId;
  const verifiedRole = settings.access.verifiedRoleId;
  return {
    byClass,
    /** Ordinary channels currently hidden from the New member role. */
    hiddenFromGate: gateRole ? byClass.other.filter((c) => viewBit(c, gateRole) === false).length : 0,
    /** Ordinary channels currently visible only to the verified role. */
    privateNow: verifiedRole
      ? byClass.other.filter((c) => viewBit(c, guild.id) === false && viewBit(c, verifiedRole) === true).length
      : 0,
  };
}

const locks = new Map<string, Promise<unknown>>();

/** Runs one channel-changing job at a time per server, so two jobs can't undo each other's work. */
export function withGuildLock<T>(guildId: string, run: () => Promise<T>): Promise<T> {
  const next = (locks.get(guildId) ?? Promise.resolve()).catch(() => {}).then(run);
  const tail = next.catch(() => {});
  locks.set(guildId, tail);
  tail.then(() => {
    if (locks.get(guildId) === tail) locks.delete(guildId);
  });
  return next;
}

/** Re-applies access with the server's latest saved settings (skipped while onboarding is off). */
export function syncAccess(guild: Guild, only?: GuildBasedChannel[]) {
  return withGuildLock(guild.id, async () => {
    const settings = await store.getActiveSettings(guild.id);
    return settings ? applyAccessNow(guild, settings, only) : null;
  });
}
