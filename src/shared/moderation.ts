import { z } from "zod";

/**
 * Moderation: settings and shapes shared by the bot and the dashboard.
 * Every action a moderator takes (or Number One takes for them) becomes a numbered "case",
 * so each member has a full history that staff can review, edit and clean up.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Longest reason Discord keeps in the audit log. */
export const MAX_REASON = 500;
/** Discord's limit for a timeout. */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
/** Longest temporary ban: one year. */
export const MAX_TEMPBAN_MS = 365 * 24 * 60 * 60 * 1000;
export const MAX_ESCALATION_STEPS = 10;

export const caseActions = ["warn", "note", "timeout", "untimeout", "kick", "ban", "unban"] as const;
export type CaseAction = (typeof caseActions)[number];

/** How each action looks in Discord and on the dashboard. */
export const actionInfo: Record<CaseAction, { label: string; past: string; emoji: string; color: number }> = {
  warn: { label: "Warn", past: "warned", emoji: "⚠️", color: 0xffc46b },
  note: { label: "Note", past: "noted", emoji: "📝", color: 0x8c8c99 },
  timeout: { label: "Timeout", past: "timed out", emoji: "⏳", color: 0xff9f43 },
  untimeout: { label: "Timeout removed", past: "un-timed out", emoji: "🔈", color: 0x5bd6a0 },
  kick: { label: "Kick", past: "kicked", emoji: "👢", color: 0xff7a59 },
  ban: { label: "Ban", past: "banned", emoji: "🔨", color: 0xff4f6d },
  unban: { label: "Unban", past: "unbanned", emoji: "🕊️", color: 0x5bd6a0 },
};

/** What an automatic step can do once a member reaches a number of warnings. */
export const escalationActions = ["timeout", "kick", "ban"] as const;

export const escalationStep = z.object({
  /** Fires when a member's active warnings reach exactly this number. */
  warnings: z.number().int().min(1).max(50),
  action: z.enum(escalationActions),
  /** Timeout length, or ban length (0 = permanent ban). Ignored for kicks. */
  durationMinutes: z.number().int().min(0).max(MAX_TEMPBAN_MS / 60_000).default(0),
});
export type EscalationStep = z.infer<typeof escalationStep>;

export const moderationSettings = z.object({
  /** Channel where every case is posted. Empty = no mod log. */
  logChannelId: snowflake.nullable().default(null),
  /** Tell members by DM when they're warned, timed out, kicked or banned. */
  dmMembers: z.boolean().default(true),
  /** Include who took the action in the DM. Off by default to protect staff. */
  dmShowModerator: z.boolean().default(false),
  /** Extra text added to ban DMs, e.g. how to appeal. */
  appealMessage: z.string().trim().max(500).default(""),
  /** Moderators must give a reason for every action. */
  requireReason: z.boolean().default(false),
  /** Default for /ban's "delete messages" option, in days (0-7). */
  banDeleteDays: z.number().int().min(0).max(7).default(0),
  /** Warnings older than this stop counting towards automatic steps. 0 = they never expire. */
  warnExpiryDays: z.number().int().min(0).max(365).default(0),
  /** Automatic steps when a member collects warnings. */
  escalation: z.array(escalationStep).max(MAX_ESCALATION_STEPS).default([]),
  /** Record bans, kicks and timeouts done directly in Discord (not through Number One) as cases too. */
  trackExternal: z.boolean().default(true),
});
export type ModerationSettings = z.infer<typeof moderationSettings>;

/** One case, as the dashboard sees it. */
export interface CaseView {
  caseNumber: number;
  action: CaseAction;
  userId: string;
  userTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string;
  durationMs: number | null;
  expiresAt: number | null;
  /** A temporary ban or a timeout that hasn't ended yet. */
  active: boolean;
  /** Taken automatically (warning steps or a temporary ban running out). */
  auto: boolean;
  /** Done directly in Discord and picked up from the audit log. */
  external: boolean;
  dmSent: boolean;
  createdAt: number;
  logUrl: string | null;
}

export interface ModerationStatus {
  totalCases: number;
  casesLast7Days: number;
  warningsLast30Days: number;
  activeTempBans: number;
  /** Permissions or channel problems, in plain words. */
  problems: string[];
}

export interface ModerationResponse {
  settings: ModerationSettings;
  status: ModerationStatus;
}

export interface CaseListResponse {
  cases: CaseView[];
  /** Pass as `before` to load the next page. Null when there are no more. */
  nextBefore: number | null;
}

/* ------------------------------------------------------------ durations */

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_592_000_000,
  y: 31_536_000_000,
};

const UNIT_ALIASES: Record<string, string> = {
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
  m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
  h: "h", hr: "h", hrs: "h", hour: "h", hours: "h",
  d: "d", day: "d", days: "d",
  w: "w", wk: "w", wks: "w", week: "w", weeks: "w",
  mo: "mo", month: "mo", months: "mo",
  y: "y", yr: "y", yrs: "y", year: "y", years: "y",
};

/**
 * Reads durations like "10m", "1h30m", "2 days" or "1w". A bare number means minutes.
 * Returns milliseconds, or null when the text isn't a duration.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * UNITS.m;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  let total = 0;
  let consumed = "";
  for (const match of t.matchAll(re)) {
    const unit = UNIT_ALIASES[match[2]];
    if (!unit) return null;
    total += Number(match[1]) * UNITS[unit];
    consumed += match[0];
  }
  // Everything except spaces and commas must have been part of a number + unit.
  if (consumed.replace(/\s/g, "") !== t.replace(/[\s,]|and/g, "")) return null;
  return total > 0 ? Math.round(total) : null;
}

/** "1 day 2 hours", "30 minutes"… (two largest units). */
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  const order: [string, number][] = [
    ["day", UNITS.d],
    ["hour", UNITS.h],
    ["minute", UNITS.m],
    ["second", UNITS.s],
  ];
  let rest = ms;
  for (const [name, size] of order) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n} ${name}${n === 1 ? "" : "s"}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0 seconds";
}

/** Short choices for the dashboard's escalation steps (minutes). */
export const durationChoices = [
  { minutes: 5, label: "5 minutes" },
  { minutes: 10, label: "10 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 6 * 60, label: "6 hours" },
  { minutes: 12 * 60, label: "12 hours" },
  { minutes: 24 * 60, label: "1 day" },
  { minutes: 3 * 24 * 60, label: "3 days" },
  { minutes: 7 * 24 * 60, label: "1 week" },
  { minutes: 14 * 24 * 60, label: "2 weeks" },
  { minutes: 28 * 24 * 60, label: "28 days" },
  { minutes: 90 * 24 * 60, label: "90 days" },
] as const;
