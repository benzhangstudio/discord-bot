import { z } from "zod";

/**
 * Auto-moderation: settings and shapes shared by the bot and the dashboard.
 *
 * Two kinds of filter:
 * - "Discord" filters (blocked words, invites, links, mass mentions) become rules in Discord's own AutoMod.
 *   Discord blocks the message before anyone sees it, and keeps doing so even when Number One is offline.
 *   Number One then takes the follow-up step (warn, time out, kick) and records it as a case.
 * - "Number One" filters (caps, emoji spam, zalgo, repeated messages, and the anti-spam limits on message rate,
 *   attachments and links) are things Discord's AutoMod can't check.
 *   Number One reads each message and deletes it if it breaks a rule. These need the Message Content intent.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Discord's limits for one AutoMod rule. The same limits are used for Number One's own filters, to keep things simple. */
export const MAX_IGNORED_ROLES = 20;
export const MAX_IGNORED_CHANNELS = 50;
export const MAX_BLOCKED_WORDS = 1000;
export const MAX_ALLOWED_WORDS = 100;
export const MAX_WORD_LENGTH = 60;
export const MAX_ALLOWED_DOMAINS = 100;

export const automodActions = ["delete", "warn", "timeout", "kick"] as const;
export type AutomodAction = (typeof automodActions)[number];

export const automodActionInfo: Record<AutomodAction, { label: string; hint: string }> = {
  delete: { label: "Delete only", hint: "Remove the message. No case is recorded." },
  warn: { label: "Delete and warn", hint: "Counts towards Moderation's automatic steps." },
  timeout: { label: "Delete and time out", hint: "Mutes them for the chosen time." },
  kick: { label: "Delete and kick", hint: "They can rejoin with an invite." },
};

/** Settings every filter has. */
const ruleBase = {
  enabled: z.boolean().default(false),
  action: z.enum(automodActions).default("delete"),
  /** Timeout length when the action is "timeout". Up to 28 days. */
  timeoutMinutes: z.number().int().min(1).max(28 * 24 * 60).default(10),
  /** Channels (or whole categories) the filter skips. */
  ignoredChannelIds: z.array(snowflake).max(MAX_IGNORED_CHANNELS).default([]),
  /** Members with any of these roles are skipped. */
  ignoredRoleIds: z.array(snowflake).max(MAX_IGNORED_ROLES).default([]),
};

const word = z.string().trim().min(1).max(MAX_WORD_LENGTH);

export const automodSettings = z.object({
  /** Where Discord and Number One post a short alert each time a filter catches something. Empty = no alerts. */
  alertChannelId: snowflake.nullable().default(null),

  /* ------------------------------------------------ Discord AutoMod filters */

  words: z
    .object({
      ...ruleBase,
      /** Supports wildcards: `bad*` (starts with), `*bad` (ends with), `*bad*` (anywhere). Plain words match whole words. */
      blocked: z.array(word).max(MAX_BLOCKED_WORDS).default([]),
      /** Words that never trigger the filter, even if they match. */
      allowed: z.array(word).max(MAX_ALLOWED_WORDS).default([]),
      /** Discord's own maintained word lists. */
      profanity: z.boolean().default(false),
      sexualContent: z.boolean().default(false),
      slurs: z.boolean().default(false),
    })
    .prefault({}),
  invites: z.object({ ...ruleBase }).prefault({}),
  links: z
    .object({
      ...ruleBase,
      /** Sites that are always allowed, like youtube.com. Subdomains are allowed too. */
      allowedDomains: z.array(z.string().trim().toLowerCase().min(3).max(MAX_WORD_LENGTH)).max(MAX_ALLOWED_DOMAINS).default([]),
    })
    .prefault({}),
  mentions: z
    .object({
      ...ruleBase,
      /** Most unique user and role mentions allowed in one message. */
      limit: z.number().int().min(2).max(50).default(5),
      /** Also let Discord spot a sudden wave of mention spam across the server. */
      raidProtection: z.boolean().default(true),
    })
    .prefault({}),

  /* ------------------------------------------------ Number One filters */

  caps: z
    .object({
      ...ruleBase,
      /** Share of letters that are capitals before a message counts as shouting. */
      percent: z.number().int().min(50).max(100).default(70),
      /** Short messages ("OK", "LOL") are never checked. Counts letters only. */
      minLetters: z.number().int().min(5).max(200).default(10),
    })
    .prefault({}),
  emoji: z
    .object({
      ...ruleBase,
      /** Most emojis (custom and normal) allowed in one message. */
      max: z.number().int().min(3).max(100).default(10),
    })
    .prefault({}),
  zalgo: z.object({ ...ruleBase }).prefault({}),
  repeated: z
    .object({
      ...ruleBase,
      /** How many copies of the same message count as spam… */
      count: z.number().int().min(2).max(10).default(3),
      /** …within this many seconds. */
      seconds: z.number().int().min(5).max(600).default(60),
    })
    .prefault({}),

  /* ------------------------------------------------ Anti-spam (Number One) */

  rate: z
    .object({
      ...ruleBase,
      action: z.enum(automodActions).default("timeout"),
      /** More than this many messages… */
      messages: z.number().int().min(3).max(30).default(7),
      /** …within this many seconds counts as spam. */
      seconds: z.number().int().min(2).max(60).default(5),
      /** Also catch posting in this many different channels within the same time. 0 = off. */
      channels: z.number().int().min(0).max(20).default(3),
    })
    .prefault({}),
  attachments: z
    .object({
      ...ruleBase,
      action: z.enum(automodActions).default("timeout"),
      /** Files, images and stickers allowed within the time window. */
      count: z.number().int().min(2).max(50).default(8),
      seconds: z.number().int().min(2).max(120).default(15),
    })
    .prefault({}),
  linkSpam: z
    .object({
      ...ruleBase,
      action: z.enum(automodActions).default("timeout"),
      /** Links allowed within the time window (counted across all messages). */
      count: z.number().int().min(2).max(50).default(6),
      seconds: z.number().int().min(2).max(120).default(15),
    })
    .prefault({}),
});

export type AutomodSettings = z.infer<typeof automodSettings>;
export type AutomodRuleKey = Exclude<keyof AutomodSettings, "alertChannelId">;
export type AutomodRule = AutomodSettings[AutomodRuleKey];

/** Filters that become rules in Discord's own AutoMod. */
export const discordRules = ["words", "invites", "links", "mentions"] as const satisfies readonly AutomodRuleKey[];
/** Filters Number One checks itself (they need to read messages). The last three are anti-spam: they look at bursts of messages. */
export const botRules = ["caps", "emoji", "zalgo", "repeated", "rate", "attachments", "linkSpam"] as const satisfies readonly AutomodRuleKey[];
export const ruleKeys: AutomodRuleKey[] = [...discordRules, ...botRules];

export const ruleInfo: Record<AutomodRuleKey, { name: string; emoji: string; description: string }> = {
  words: { name: "Blocked words", emoji: "🤬", description: "Words and phrases nobody can post. Supports wildcards." },
  invites: { name: "Invite links", emoji: "📨", description: "Discord server invites (discord.gg and similar)." },
  links: { name: "Links", emoji: "🔗", description: "Any web link, except sites you allow." },
  mentions: { name: "Mass mentions", emoji: "📣", description: "Messages that ping too many people or roles at once." },
  caps: { name: "Excessive caps", emoji: "🔠", description: "MESSAGES THAT ARE MOSTLY CAPITAL LETTERS." },
  emoji: { name: "Emoji spam", emoji: "😵", description: "Messages stuffed with emojis." },
  zalgo: { name: "Zalgo text", emoji: "👹", description: "Glitchy text made with stacked accent marks." },
  repeated: { name: "Repeated messages", emoji: "🔁", description: "The same message posted again and again, in any channel." },
  rate: { name: "Message rate", emoji: "⚡", description: "Too many messages too fast, or posting across many channels at once (typical of hacked accounts)." },
  attachments: { name: "Attachment spam", emoji: "📎", description: "Floods of images, files or stickers in a short time." },
  linkSpam: { name: "Link spam", emoji: "🧷", description: "Lots of links in a short time, even when each message only has one." },
};

/**
 * Whether a Number One filter has to read what messages say (needs the Message Content intent).
 * Message rate only counts messages, so it works without it.
 */
export const needsContent = (key: AutomodRuleKey) => (botRules as readonly string[]).includes(key) && key !== "rate";

/** The anti-spam filters (shown in their own group on the dashboard). */
export const spamRules = ["rate", "attachments", "linkSpam"] as const satisfies readonly AutomodRuleKey[];

export interface AutomodStatus {
  /** Discord AutoMod rules Number One currently manages in this server. */
  discordRulesActive: number;
  /** Whether Number One can read message content (needed for its own filters). */
  canReadMessages: boolean;
  /** Messages caught by Number One's own filters since the bot last started. */
  caughtSinceRestart: number;
  /** Permissions, limits or channel problems, in plain words. */
  problems: string[];
}

export interface AutomodResponse {
  settings: AutomodSettings;
  status: AutomodStatus;
}
