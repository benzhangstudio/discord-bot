import { z } from "zod";

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
  { id: "moderation", name: "Moderation & safety", emoji: "🛡️", description: "Warnings, timeouts, bans and keeping spam out" },
  { id: "roles", name: "Roles", emoji: "🎭", description: "Let members pick their own roles" },
  { id: "welcome", name: "Welcome & onboarding", emoji: "👋", description: "Greet new members and give starting roles" },
  { id: "logging", name: "Server logs", emoji: "📋", description: "Keep a record of joins, leaves, edits and deletes" },
  { id: "engagement", name: "Community & engagement", emoji: "🎉", description: "Levels, polls, giveaways and events" },
] as const;

export type CategoryId = (typeof categories)[number]["id"];
export const categoryIds = categories.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export interface FeatureInfo<S extends z.ZodObject = z.ZodObject> {
  id: string;
  name: string;
  description: string;
  /** Which /setup category this belongs to. Core features have none. */
  category?: CategoryId;
  /** Switched on automatically when the server picks this feature's category in /setup. */
  recommended?: boolean;
  /** Core features can't be turned off. */
  alwaysOn?: boolean;
  /** Settings shape. Every field needs a default so a fresh server works without setup. */
  settings: S;
}

const defineFeature = <S extends z.ZodObject>(info: FeatureInfo<S>) => info;

export const coreFeature = defineFeature({
  id: "core",
  name: "Core",
  description: "/setup, /dashboard and /ping. Always on.",
  alwaysOn: true,
  settings: z.object({}),
});

export const reactionRolesFeature = defineFeature({
  id: "reaction-roles",
  name: "Reaction roles",
  description: "Members pick their own roles by reacting to a message. Build the messages below.",
  category: "roles",
  recommended: true,
  settings: z.object({}),
});

export const featureCatalog: FeatureInfo[] = [coreFeature, reactionRolesFeature];

export function getFeatureInfo(id: string): FeatureInfo | undefined {
  return featureCatalog.find((f) => f.id === id);
}

export const featuresInCategory = (id: CategoryId) => featureCatalog.filter((f) => f.category === id);

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

/** A reaction-role message as the dashboard shows it. */
export interface ReactionRoleMessageView {
  messageId: string;
  channelId: string;
  title: string;
  description: string;
  singleChoice: boolean;
  url: string;
  entries: { emojiKey: string; emojiDisplay: string; emojiUrl: string | null; roleId: string }[];
}

/** What the dashboard sends to create or update a reaction-role message. */
export const reactionRoleInput = z.object({
  channelId: z.string().regex(/^\d{17,20}$/),
  title: z.string().trim().min(1, "Add a title").max(256),
  description: z.string().max(2000).default(""),
  singleChoice: z.boolean().default(false),
  entries: z
    .array(z.object({ emoji: z.string().trim().min(1, "Pick an emoji"), roleId: z.string().regex(/^\d{17,20}$/, "Pick a role") }))
    .max(20, "A message can have at most 20 reactions"),
});
export type ReactionRoleInput = z.infer<typeof reactionRoleInput>;
