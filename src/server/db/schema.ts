import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
export const reactionRoleMessages = sqliteTable("reaction_role_messages", {
  messageId: text("message_id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  /** Single choice: members can hold only one role from this message at a time. */
  singleChoice: integer("single_choice", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

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
  },
  (t) => [primaryKey({ columns: [t.messageId, t.emojiKey] })],
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
