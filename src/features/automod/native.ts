import {
  type AutoModerationActionOptions,
  AutoModerationActionType,
  type AutoModerationRule,
  type AutoModerationRuleCreateOptions,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  DiscordAPIError,
  type Guild,
  PermissionFlagsBits,
} from "discord.js";
import { type AutomodRule, type AutomodRuleKey, type AutomodSettings, ruleInfo } from "../../shared/automod.js";

/**
 * Keeps the Discord AutoMod rules that Number One owns in step with the dashboard settings.
 * Rules are found by their creator (Number One) and their name, so nothing extra is stored.
 * Rules other people made are never touched.
 */

const PREFIX = "Number One · ";

/** One Discord rule Number One manages. "wordLists" is the blocked-words filter's Discord word lists (a separate rule type in Discord). */
type NativeKey = "words" | "wordLists" | "invites" | "links" | "mentions";

const NAMES: Record<NativeKey, string> = {
  words: `${PREFIX}Blocked words`,
  wordLists: `${PREFIX}Discord word lists`,
  invites: `${PREFIX}Invite links`,
  links: `${PREFIX}Links`,
  mentions: `${PREFIX}Mass mentions`,
};

/** Which dashboard filter a Discord rule belongs to. */
const FILTER_OF: Record<NativeKey, AutomodRuleKey> = {
  words: "words",
  wordLists: "words",
  invites: "invites",
  links: "links",
  mentions: "mentions",
};

const BLOCK_NOTE = "Blocked by this server's auto-moderation.";

/** Discord server invites, in the usual forms. */
const INVITE_PATTERNS = ["(?i)(discord(app)?\\.com/invite|discord\\.gg|discord\\.me|dsc\\.gg)/[a-z0-9-]+"];
/**
 * Web links. Each pattern stops at the end of the site name, so the allow list (`*youtube.com`) is checked
 * against "https://www.youtube.com" rather than the whole link.
 */
const LINK_PATTERNS = ["(?i)https?://[^\\s/?#<>|]+", "(?i)\\bwww\\.[^\\s/?#<>|]+"];

/** Makes "https://www.YouTube.com/x" into "youtube.com". */
export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/^\*\.?/, "");
}

/** Which filter a caught message belongs to, from the Discord rule's name. Null if it isn't one of Number One's rules. */
export function filterForRule(rule: AutoModerationRule | null): AutomodRuleKey | null {
  if (!rule || rule.creatorId !== rule.client.user.id) return null;
  const key = (Object.keys(NAMES) as NativeKey[]).find((k) => NAMES[k] === rule.name);
  return key ? FILTER_OF[key] : null;
}

function actionsFor(rule: AutomodRule, settings: AutomodSettings, canTimeout: boolean): AutoModerationActionOptions[] {
  const actions: AutoModerationActionOptions[] = [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: BLOCK_NOTE } }];
  if (settings.alertChannelId) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: settings.alertChannelId } });
  // Discord times the member out itself, so it still happens while Number One is offline.
  // (Number One then records the case. Discord only allows timeouts on keyword and mention rules.)
  if (rule.action === "timeout" && canTimeout) {
    actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: rule.timeoutMinutes * 60 } });
  }
  return actions;
}

/** The Discord rules the settings call for. Missing keys mean "this rule shouldn't exist". */
function desiredRules(guild: Guild, settings: AutomodSettings): Partial<Record<NativeKey, AutoModerationRuleCreateOptions>> {
  const canTimeout = Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers));
  const base = (key: NativeKey, rule: AutomodRule, timeoutAllowed = true) => ({
    name: NAMES[key],
    eventType: AutoModerationRuleEventType.MessageSend,
    actions: actionsFor(rule, settings, canTimeout && timeoutAllowed),
    enabled: true,
    exemptRoles: rule.ignoredRoleIds,
    exemptChannels: rule.ignoredChannelIds,
    reason: "Number One auto-moderation settings",
  });
  const out: Partial<Record<NativeKey, AutoModerationRuleCreateOptions>> = {};

  const { words, invites, links, mentions } = settings;
  if (words.enabled && words.blocked.length) {
    out.words = {
      ...base("words", words),
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: words.blocked, allowList: words.allowed },
    };
  }
  const presets = [
    words.profanity && AutoModerationRuleKeywordPresetType.Profanity,
    words.sexualContent && AutoModerationRuleKeywordPresetType.SexualContent,
    words.slurs && AutoModerationRuleKeywordPresetType.Slurs,
  ].filter((p): p is AutoModerationRuleKeywordPresetType => typeof p === "number");
  if (words.enabled && presets.length) {
    out.wordLists = {
      ...base("wordLists", words, false),
      triggerType: AutoModerationRuleTriggerType.KeywordPreset,
      triggerMetadata: { presets, allowList: words.allowed },
    };
  }
  if (invites.enabled) {
    out.invites = {
      ...base("invites", invites),
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: INVITE_PATTERNS },
    };
  }
  if (links.enabled) {
    out.links = {
      ...base("links", links),
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: LINK_PATTERNS, allowList: links.allowedDomains.map((d) => `*${cleanDomain(d)}`) },
    };
  }
  if (mentions.enabled) {
    out.mentions = {
      ...base("mentions", mentions),
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: mentions.limit, mentionRaidProtectionEnabled: mentions.raidProtection },
    };
  }
  return out;
}

/** A comparable summary of a rule, to skip edits that wouldn't change anything. */
function signature(r: {
  enabled: boolean;
  exemptRoles: readonly string[];
  exemptChannels: readonly string[];
  triggerMetadata?: Record<string, unknown> | null;
  actions: readonly { type: number; metadata?: Record<string, unknown> | null }[];
}): string {
  const sorted = (a: readonly unknown[] | undefined | null) => [...(a ?? [])].map(String).sort();
  const m = r.triggerMetadata ?? {};
  return JSON.stringify({
    enabled: r.enabled,
    roles: sorted(r.exemptRoles),
    channels: sorted(r.exemptChannels),
    keywords: sorted(m.keywordFilter as string[]),
    regex: sorted(m.regexPatterns as string[]),
    allow: sorted(m.allowList as string[]),
    presets: sorted(m.presets as number[]),
    limit: m.mentionTotalLimit ?? null,
    raid: m.mentionRaidProtectionEnabled ?? null,
    actions: r.actions
      .map((a) => {
        const md = a.metadata ?? {};
        const channel = md.channel ?? md.channelId ?? null;
        return `${a.type}:${typeof channel === "object" && channel ? (channel as { id: string }).id : (channel ?? "")}:${md.durationSeconds ?? ""}`;
      })
      .sort(),
  });
}

function existingSignature(rule: AutoModerationRule): string {
  return signature({
    enabled: rule.enabled,
    exemptRoles: [...rule.exemptRoles.keys()],
    exemptChannels: [...rule.exemptChannels.keys()],
    triggerMetadata: rule.triggerMetadata as unknown as Record<string, unknown>,
    actions: rule.actions.map((a) => ({ type: a.type, metadata: a.metadata as unknown as Record<string, unknown> })),
  });
}

function wantedSignature(r: AutoModerationRuleCreateOptions): string {
  return signature({
    enabled: r.enabled ?? true,
    exemptRoles: (r.exemptRoles ?? []) as string[],
    exemptChannels: (r.exemptChannels ?? []) as string[],
    triggerMetadata: r.triggerMetadata as Record<string, unknown>,
    actions: r.actions.map((a) => ({ type: a.type, metadata: a.metadata as Record<string, unknown> })),
  });
}

/** Turns a Discord error into plain words. */
function explain(err: unknown, key: NativeKey): string {
  const what = ruleInfo[FILTER_OF[key]].name;
  if (err instanceof DiscordAPIError) {
    if (err.code === 50013) return `Discord didn't let me set up the ${what} filter. I need the Manage Server permission.`;
    if (err.code === 30035 || /maximum/i.test(err.message)) {
      return `Discord's AutoMod rule limit is full, so the ${what} filter couldn't be added. Delete an unused rule in Server Settings → AutoMod.`;
    }
    return `Discord didn't accept the ${what} filter: ${err.message}`;
  }
  console.warn(`[automod] ${key} rule failed:`, err);
  return `The ${what} filter couldn't be set up. Please try again.`;
}

/** Problems from the last sync of each server, shown on the dashboard. */
const lastProblems = new Map<string, string[]>();
export const syncProblems = (guildId: string) => lastProblems.get(guildId) ?? [];

/** How many Discord rules Number One manages in a server (from the cache filled by the last sync). */
export function activeRuleCount(guild: Guild): number {
  return guild.autoModerationRules.cache.filter((r) => r.creatorId === guild.client.user.id && r.name.startsWith(PREFIX)).size;
}

/**
 * Creates, updates and deletes Number One's Discord AutoMod rules to match the settings.
 * With `enabled` false, every rule Number One made is removed.
 * Returns problems in plain words (also kept for the dashboard).
 */
export async function syncRules(guild: Guild, settings: AutomodSettings, enabled: boolean): Promise<string[]> {
  const me = guild.members.me;
  const wanted = enabled ? desiredRules(guild, settings) : {};
  const problems: string[] = [];

  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    if (Object.keys(wanted).length) problems.push("I need the Manage Server permission to set up Discord AutoMod filters.");
    lastProblems.set(guild.id, problems);
    return problems;
  }

  let rules;
  try {
    rules = await guild.autoModerationRules.fetch();
  } catch (err) {
    console.warn(`[automod] couldn't read rules in ${guild.name} (${guild.id}):`, (err as Error).message);
    problems.push("I couldn't read this server's AutoMod rules. Check that I have the Manage Server permission.");
    lastProblems.set(guild.id, problems);
    return problems;
  }
  const mine = rules.filter((r) => r.creatorId === guild.client.user.id && r.name.startsWith(PREFIX));

  for (const key of Object.keys(NAMES) as NativeKey[]) {
    const want = wanted[key];
    const matches = [...mine.filter((r) => r.name === NAMES[key]).values()];
    const [have, ...extra] = matches;
    try {
      for (const dupe of extra) await dupe.delete("Duplicate Number One rule");
      if (want && have) {
        if (existingSignature(have) !== wantedSignature(want)) {
          await have.edit({
            enabled: want.enabled,
            triggerMetadata: want.triggerMetadata,
            actions: want.actions,
            exemptRoles: want.exemptRoles,
            exemptChannels: want.exemptChannels,
            reason: want.reason,
          });
        }
      } else if (want) {
        await guild.autoModerationRules.create(want);
      } else if (have) {
        await have.delete(enabled ? "Filter turned off in Number One" : "Auto-moderation turned off in Number One");
      }
    } catch (err) {
      problems.push(explain(err, key));
    }
  }

  // Rules Number One made under a name it no longer uses.
  for (const rule of mine.values()) {
    if (!Object.values(NAMES).includes(rule.name)) await rule.delete("Old Number One rule").catch(() => {});
  }

  lastProblems.set(guild.id, problems);
  return problems;
}
