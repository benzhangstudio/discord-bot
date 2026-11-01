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
