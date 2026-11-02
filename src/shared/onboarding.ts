import { z } from "zod";

/**
 * Member onboarding settings, shared by the bot and the dashboard.
 * Every part is optional and can be switched on or off by admins. Defaults are safe:
 * only the welcome message is on, and it posts in the server's system channel.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
const roleList = (max: number) => z.array(snowflake).max(max).default([]);

export const MAX_QUESTIONS = 5;
export const MAX_OPTIONS = 10;
export const MAX_ROLES_PER_OPTION = 5;
export const MAX_STAFF_CATEGORIES = 10;
export const MAX_ACCESS_CHANNELS = 50;

/**
 * Answer labels show in a one-line Discord dropdown, which cuts off long text.
 * 50 matches Discord's own onboarding limit and fits on one line on desktop.
 */
export const MAX_ANSWER_LABEL = 50;

export const onboardingOption = z.object({
  id: z.string().min(1).max(40),
  // Answers saved before this limit existed (up to 80 characters) are shortened instead of
  // failing validation, which would otherwise reset the server's whole onboarding setup.
  label: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().slice(0, MAX_ANSWER_LABEL).trim() : v),
    z.string().min(1, "Every answer needs a label").max(MAX_ANSWER_LABEL),
  ),
  description: z.string().trim().max(100).default(""),
  emoji: z.string().trim().max(80).default(""),
  roleIds: roleList(MAX_ROLES_PER_OPTION),
});

export const onboardingQuestion = z.object({
  id: z.string().min(1).max(40),
  title: z.string().trim().min(1, "Every question needs a title").max(100),
  description: z.string().trim().max(300).default(""),
  /** Members may pick more than one answer. */
  multiple: z.boolean().default(false),
  /** Members must answer before continuing. */
  required: z.boolean().default(false),
  options: z.array(onboardingOption).min(1, "Every question needs at least one answer").max(MAX_OPTIONS),
});

export const welcomeTiming = z.enum(["join", "complete"]);

export const onboardingSettings = z.object({
  welcome: z
    .object({
      enabled: z.boolean().default(true),
      /** Empty = the server's system channel. */
      channelId: snowflake.nullable().default(null),
      message: z.string().max(1800).default("Welcome {user} to **{server}**! You're member #{memberCount}."),
      /** Show the message in a pink card instead of plain text. */
      useEmbed: z.boolean().default(true),
      /** Post on join, or once the member finishes onboarding (only when onboarding steps are on). */
      when: welcomeTiming.default("join"),
      dmEnabled: z.boolean().default(false),
      dmMessage: z.string().max(1800).default("Welcome to **{server}**, {username}! We're glad you're here."),
    })
    .default({
      enabled: true,
      channelId: null,
      message: "Welcome {user} to **{server}**! You're member #{memberCount}.",
      useEmbed: true,
      when: "join",
      dmEnabled: false,
      dmMessage: "Welcome to **{server}**, {username}! We're glad you're here.",
    }),
  goodbye: z
    .object({
      enabled: z.boolean().default(false),
      channelId: snowflake.nullable().default(null),
      message: z.string().max(1800).default("**{username}** left {server}. We now have {memberCount} members."),
    })
    .default({ enabled: false, channelId: null, message: "**{username}** left {server}. We now have {memberCount} members." }),
  /** Roles every new member gets right away. */
  joinRoles: roleList(10),
  /** Roles given to bots that join (bots skip onboarding). */
  botRoles: roleList(10),
  flow: z
    .object({
      enabled: z.boolean().default(false),
      /** Channel holding the "Start" message. */
      channelId: snowflake.nullable().default(null),
      intro: z.string().max(1500).default("Welcome! Answer a few quick questions to get set up and unlock the server."),
      rulesEnabled: z.boolean().default(false),
      rules: z.string().max(3500).default(""),
      questions: z.array(onboardingQuestion).max(MAX_QUESTIONS).default([]),
    })
    .default({
      enabled: false,
      channelId: null,
      intro: "Welcome! Answer a few quick questions to get set up and unlock the server.",
      rulesEnabled: false,
      rules: "",
      questions: [],
    }),
  gate: z
    .object({
      enabled: z.boolean().default(false),
      /** The temporary role new members hold until they finish onboarding. */
      roleId: snowflake.nullable().default(null),
      /** Remove members who haven't finished after this many hours. 0 = never. */
      kickAfterHours: z.number().int().min(0).max(720).default(0),
    })
    .default({ enabled: false, roleId: null, kickAfterHours: 0 }),
  /**
   * The access gate's channel rules. Everything not listed here becomes visible only to the verified role.
   * See src/features/onboarding/access.ts.
   */
  access: z
    .object({
      /** Categories Number One never changes, nor anything inside them. */
      staffCategoryIds: z.array(snowflake).max(MAX_STAFF_CATEGORIES).default([]),
      /** Channels (or whole categories) left exactly as they are, e.g. #rules or #announcements. */
      whitelistChannelIds: z.array(snowflake).max(MAX_ACCESS_CHANNELS).default([]),
      /**
       * Given when members finish onboarding. Private channels are shown only to this role, so finishing
       * is what opens the server. Picked by the owner, or created by "Set it up for me" when left empty.
       */
      verifiedRoleId: snowflake.nullable().default(null),
    })
    .default({ staffCategoryIds: [], whitelistChannelIds: [], verifiedRoleId: null }),
});

export type OnboardingSettings = z.infer<typeof onboardingSettings>;
export type OnboardingQuestion = z.infer<typeof onboardingQuestion>;

/** Placeholders admins can use in welcome, DM and goodbye messages. */
export const PLACEHOLDERS = [
  { key: "{user}", means: "mentions the member" },
  { key: "{username}", means: "the member's name" },
  { key: "{server}", means: "the server's name" },
  { key: "{memberCount}", means: "how many members the server has" },
  { key: "{startChannel}", means: "links the onboarding channel" },
] as const;

/** Numbers shown on the dashboard. */
export interface OnboardingActivity {
  pending: number;
  completedLast7Days: number;
  joinedLast7Days: number;
}

/** Live member numbers, shown on the dashboard and the Start card. null = not tracked (no such role). */
export interface OnboardingCounts {
  members: number;
  verified: number | null;
  atGate: number | null;
}

/** Progress of "Make the rest of the server private" (or of letting everyone in when switching off). */
export interface PrivateJob {
  phase: "roles" | "channels" | "done" | "failed";
  /** Members given the verified role so far, out of `total`. */
  done: number;
  total: number;
  error?: string;
}

/** Bot-managed state the dashboard shows but doesn't edit directly. */
export interface OnboardingStatus {
  startMessageUrl: string | null;
  /** Number of channels currently hidden from the gate role. */
  hiddenChannels: number;
  totalChannels: number;
  communityOnboarding: boolean;
  activity: OnboardingActivity;
  counts: OnboardingCounts;
  /** Private mode is on: ordinary channels are only visible to the verified role. */
  privateMode: boolean;
  /** Channels currently visible only to the verified role. */
  privateChannels: number;
  privateJob: PrivateJob | null;
}
