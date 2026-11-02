import { z } from "zod";
import { moderationSettings } from "./moderation.js";
import { onboardingSettings } from "./onboarding.js";

/**
 * The single definition of every feature: its name, description, category and settings shape.
 * Shared by the bot (to read settings) and the dashboard (to show and edit them),
 * so the two can never disagree about what a setting is called or what values it allows.
 *
 * To add a feature: add an entry here, then a matching folder in src/features/.
 */

/**
 * What a server can use Number One for. /setup asks owners to pick these, and the
 * recommended features in each picked category are switched on. Features added to a
 * category later switch on automatically for servers that picked it.
 */
export const categories = [
  {
    id: "moderation",
    name: "Moderation & Safety",
    emoji: "🛡️",
    description: "Warnings, bans, timeouts, auto-moderation, anti-spam and anti-raid",
  },
  {
    id: "community",
    name: "Community Settings",
    emoji: "👥",
    description: "Welcome messages, member onboarding and verification",
  },
  {
    id: "roles",
    name: "Roles Management",
    emoji: "🎭",
    description: "Reaction roles, role menus and auto roles",
  },
  {
    id: "logging",
    name: "Logging & Auditing",
    emoji: "📋",
    description: "Track joins, leaves, message edits, deletes and moderator actions",
  },
  {
    id: "engagement",
    name: "Engagement & Fun",
    emoji: "🎉",
    description: "Levels, giveaways, polls, starboard and events",
  },
  {
    id: "utility",
    name: "Utilities & Automation",
    emoji: "🛠️",
    description: "Custom commands, tickets, reminders and social feeds",
  },
] as const;

export type CategoryId = (typeof categories)[number]["id"];
export const categoryIds = categories.map((c) => c.id) as [CategoryId, ...CategoryId[]];

/**
 * Older category IDs that servers may have saved, and the category they now belong to.
 * ("roles" is a category of its own again: Community & Roles was split into Community Settings and
 * Roles Management, and servers that had picked it were given both by migration 0009.)
 */
export const legacyCategories: Record<string, CategoryId> = { welcome: "community" };

export interface FeatureInfo<S extends z.ZodObject = z.ZodObject> {
  id: string;
  name: string;
  description: string;
  /** Emoji shown next to the feature in the dashboard menu and cards. */
  icon?: string;
  /** Which /setup category this belongs to. Core features have none. */
  category?: CategoryId;
  /** Switched on automatically when the server picks this feature's category in /setup. */
  recommended?: boolean;
  /** Core features can't be turned off. */
  alwaysOn?: boolean;
  /**
   * Still being built. The dashboard shows a "work in progress" notice instead of settings,
   * the feature counts as off in every server, and /setup doesn't switch it on.
   * Saved settings are kept, so removing this flag brings everything back.
   */
  workInProgress?: boolean;
  /** Settings shape. Every field needs a default so a fresh server works without setup. */
  settings: S;
}

const defineFeature = <S extends z.ZodObject>(info: FeatureInfo<S>) => info;

export const coreFeature = defineFeature({
  id: "core",
  name: "Core",
  icon: "⭐",
  description: "/setup, /dashboard and /ping. Always on.",
  alwaysOn: true,
  settings: z.object({}),
});

export const reactionRolesFeature = defineFeature({
  id: "reaction-roles",
  name: "Reaction roles",
  icon: "🎭",
  description: "Members pick their own roles with reactions, buttons or a dropdown menu.",
  category: "roles",
  recommended: true,
  settings: z.object({}),
});

export const onboardingFeature = defineFeature({
  id: "onboarding",
  name: "Member onboarding",
  icon: "👋",
  description: "Welcome new members, give starting roles, and walk them through rules and questions. No Community settings needed.",
  category: "community",
  recommended: true,
  settings: onboardingSettings,
});

export const moderationFeature = defineFeature({
  id: "moderation",
  name: "Moderation",
  icon: "🔨",
  description: "Warn, time out, kick and ban members, with numbered cases, a mod log, DMs and automatic steps for repeat warnings.",
  category: "moderation",
  recommended: true,
  settings: moderationSettings,
});

export const featureCatalog: FeatureInfo[] = [coreFeature, moderationFeature, onboardingFeature, reactionRolesFeature];

export function getFeatureInfo(id: string): FeatureInfo | undefined {
  return featureCatalog.find((f) => f.id === id);
}

export const featuresInCategory = (id: CategoryId) => featureCatalog.filter((f) => f.category === id);

/** Features a server can actually use today (not core, not work in progress). */
export const isUsable = (f: FeatureInfo) => Boolean(f.category && !f.workInProgress);

/** What the API returns for one feature in one server. */
export interface FeatureState {
  id: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

/** A server's /setup answers. */
export interface SetupState {
  categories: CategoryId[];
  completed: boolean;
}

/** What the API returns for the server list. */
export interface DashboardGuild {
  id: string;
  name: string;
  icon: string | null;
  /** Whether the bot is already in this server. */
  botPresent: boolean;
}

export interface DashboardUser {
  id: string;
  username: string;
  avatar: string | null;
}

export * from "./reactionRoles.js";
export * from "./moderation.js";
