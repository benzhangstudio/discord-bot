import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per (server, feature): whether the feature is on and its settings.
 * Settings are stored as JSON and validated by the feature's schema in src/shared/features.
 * Features that need their own records (warnings, tickets, logs...) add their own tables below.
 */
export const featureSettings = sqliteTable(
  "feature_settings",
  {
    guildId: text("guild_id").notNull(),
    featureId: text("feature_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.featureId] })],
);

/** Dashboard login sessions. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  accessToken: text("access_token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** Reaction roles: one row per reaction-role message the bot posted. */
export const reactionRoleMessages = sqliteTable(
  "reaction_role_messages",
  {
    messageId: text("message_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    /** Embed title. */
    title: text("title").notNull(),
    /** Embed description. */
    description: text("description").notNull().default(""),
    /** Old single-choice switch. Replaced by mode = "unique"; kept so old databases still migrate. */
    singleChoice: integer("single_choice", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Internal name shown only in the dashboard. */
    name: text("name").notNull().default(""),
    /** "reactions", "buttons" or "dropdown". */
    kind: text("kind").notNull().default("reactions"),
    /** Selection mode (see src/shared/reactionRoles.ts). Replaces single_choice, which is kept only for old rows. */
    mode: text("mode").notNull().default("normal"),
    /** Plain text above the embed. */
    content: text("content").notNull().default(""),
    /** Embed look, restrictions and other per-message options (JSON, validated by reactionRoleOptions). */
    options: text("options", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  },
  // Lookups by server (dashboard list) and channel (cleanup when a channel is deleted).
  (t) => [index("reaction_role_messages_guild_idx").on(t.guildId), index("reaction_role_messages_channel_idx").on(t.channelId)],
);

/** Reaction roles: which emoji gives which role on a message. */
export const reactionRoleEntries = sqliteTable(
  "reaction_role_entries",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => reactionRoleMessages.messageId, { onDelete: "cascade" }),
    /** Custom emoji ID, or the Unicode emoji itself (without variation selectors). */
    emojiKey: text("emoji_key").notNull(),
    /** How to show / react with the emoji: "<:name:id>" or the Unicode emoji. */
    emojiDisplay: text("emoji_display").notNull(),
    roleId: text("role_id").notNull(),
    position: integer("position").notNull(),
    /** Button text / dropdown option name ("" = use the role's name). */
    label: text("label").notNull().default(""),
    /** Dropdown option description. */
    description: text("description").notNull().default(""),
    /** Button colour: primary, secondary, success or danger. */
    style: text("style").notNull().default("secondary"),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.emojiKey] }), index("reaction_role_entries_role_idx").on(t.roleId)],
);

/** Answers from /setup: what each server uses Number One for. */
export const guildSetup = sqliteTable("guild_setup", {
  guildId: text("guild_id").primaryKey(),
  categories: text("categories", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** Empty until someone finishes /setup (or the dashboard's setup section). */
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  completedBy: text("completed_by"),
  /** When the "thanks for adding me" message was posted, so it's only sent once. */
  welcomedAt: integer("welcomed_at", { mode: "timestamp_ms" }),
});

/** Onboarding: where each member is in the onboarding steps. */
export const onboardingProgress = sqliteTable(
  "onboarding_progress",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    /** pending (joined, hasn't started), started, or done. */
    status: text("status", { enum: ["pending", "started", "done"] }).notNull(),
    step: integer("step").notNull().default(0),
    /** Question ID → chosen answer IDs. */
    answers: text("answers", { mode: "json" }).$type<Record<string, string[]>>().notNull().default({}),
    rulesAccepted: integer("rules_accepted", { mode: "boolean" }).notNull().default(false),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    /** Whether the welcome message has been posted for this member. */
    welcomed: integer("welcomed", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

/** Onboarding: bot-managed details per server (the posted "Start" message). */
export const onboardingState = sqliteTable("onboarding_state", {
  guildId: text("guild_id").primaryKey(),
  startChannelId: text("start_channel_id"),
  startMessageId: text("start_message_id"),
});
