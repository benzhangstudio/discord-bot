import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { reactionRoleEntries, reactionRoleMessages, reactionRoleStats, reactionRoleTimers } from "../../server/db/schema.js";
import type { z } from "zod";
import {
  type ReactionRoleKind,
  type ReactionRoleMode,
  reactionRoleKinds,
  reactionRoleModes,
  reactionRoleOptions,
} from "../../shared/reactionRoles.js";

export type ReactionRoleMessage = typeof reactionRoleMessages.$inferSelect;
export type ReactionRoleEntry = typeof reactionRoleEntries.$inferSelect;
/** A saved message with its roles, its kind/mode checked and its options filled in with defaults. */
export type ReactionRoleConfig = Omit<ReactionRoleMessage, "kind" | "mode" | "options"> & {
  kind: ReactionRoleKind;
  mode: ReactionRoleMode;
  options: z.infer<typeof reactionRoleOptions>;
  entries: ReactionRoleEntry[];
};

const KINDS = new Set<string>(reactionRoleKinds.map((k) => k.id));
const MODES = new Set<string>(reactionRoleModes.map((m) => m.id));

export function toConfig(message: ReactionRoleMessage, entries: ReactionRoleEntry[]): ReactionRoleConfig {
  const parsed = reactionRoleOptions.safeParse(message.options ?? {});
  return {
    ...message,
    kind: (KINDS.has(message.kind) ? message.kind : "reactions") as ReactionRoleKind,
    mode: (MODES.has(message.mode) ? message.mode : message.singleChoice ? "unique" : "normal") as ReactionRoleMode,
    options: parsed.success ? parsed.data : reactionRoleOptions.parse({}),
    entries,
  };
}

export async function getConfig(messageId: string): Promise<ReactionRoleConfig | undefined> {
  const message = await db.select().from(reactionRoleMessages).where(eq(reactionRoleMessages.messageId, messageId)).get();
  if (!message) return;
  const entries = await db
    .select()
    .from(reactionRoleEntries)
    .where(eq(reactionRoleEntries.messageId, messageId))
    .orderBy(asc(reactionRoleEntries.position))
    .all();
  return toConfig(message, entries);
}

export async function listConfigs(guildId: string): Promise<ReactionRoleConfig[]> {
  const messages = await db
    .select()
    .from(reactionRoleMessages)
    .where(eq(reactionRoleMessages.guildId, guildId))
    .orderBy(asc(reactionRoleMessages.createdAt))
    .all();
  if (!messages.length) return [];
  const entries = await db
    .select()
    .from(reactionRoleEntries)
    .where(inArray(reactionRoleEntries.messageId, messages.map((m) => m.messageId)))
    .orderBy(asc(reactionRoleEntries.position))
    .all();
  return messages.map((m) => toConfig(m, entries.filter((e) => e.messageId === m.messageId)));
}

export async function countConfigs(guildId: string): Promise<number> {
  const rows = await db
    .select({ id: reactionRoleMessages.messageId })
    .from(reactionRoleMessages)
    .where(eq(reactionRoleMessages.guildId, guildId))
    .all();
  return rows.length;
}

export async function createMessage(values: ReactionRoleMessage) {
  await db.insert(reactionRoleMessages).values(values).run();
}

export async function updateMessage(
  messageId: string,
  values: Partial<Pick<ReactionRoleMessage, "external" | "title" | "description" | "name" | "kind" | "mode" | "content" | "options" | "singleChoice">>,
) {
  await db.update(reactionRoleMessages).set(values).where(eq(reactionRoleMessages.messageId, messageId)).run();
}

export async function deleteMessage(messageId: string) {
  await db.delete(reactionRoleEntries).where(eq(reactionRoleEntries.messageId, messageId)).run();
  await db.delete(reactionRoleMessages).where(eq(reactionRoleMessages.messageId, messageId)).run();
}

export async function deleteMessagesInChannel(channelId: string) {
  const rows = await db
    .select({ id: reactionRoleMessages.messageId })
    .from(reactionRoleMessages)
    .where(eq(reactionRoleMessages.channelId, channelId))
    .all();
  for (const row of rows) await deleteMessage(row.id);
  return rows.length;
}

/** Adds or replaces one row (an emoji, button or dropdown option) on a message. */
export async function setEntry(entry: ReactionRoleEntry) {
  const { messageId, emojiKey, ...rest } = entry;
  await db
    .insert(reactionRoleEntries)
    .values(entry)
    .onConflictDoUpdate({ target: [reactionRoleEntries.messageId, reactionRoleEntries.emojiKey], set: rest })
    .run();
}

export async function removeEntry(messageId: string, emojiKey: string) {
  await db
    .delete(reactionRoleEntries)
    .where(and(eq(reactionRoleEntries.messageId, messageId), eq(reactionRoleEntries.emojiKey, emojiKey)))
    .run();
}

/** Removes every mapping that uses a role (when the role is deleted). Returns the affected message IDs. */
export async function removeRoleEverywhere(roleId: string): Promise<string[]> {
  const rows = await db
    .select({ messageId: reactionRoleEntries.messageId })
    .from(reactionRoleEntries)
    .where(eq(reactionRoleEntries.roleId, roleId))
    .all();
  await db.delete(reactionRoleEntries).where(eq(reactionRoleEntries.roleId, roleId)).run();
  return [...new Set(rows.map((r) => r.messageId))];
}

/* ---------------------------------------------------------------- stats */

/** Counts what a menu just did. Runs after every successful change, so it stays cheap. */
export async function recordUse(messageId: string, added: string[], removed: string[]) {
  const now = new Date();
  for (const [roleId, a, r] of [...added.map((id) => [id, 1, 0] as const), ...removed.map((id) => [id, 0, 1] as const)]) {
    await db
      .insert(reactionRoleStats)
      .values({ messageId, roleId, added: a, removed: r, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [reactionRoleStats.messageId, reactionRoleStats.roleId],
        set: {
          added: sql`${reactionRoleStats.added} + ${a}`,
          removed: sql`${reactionRoleStats.removed} + ${r}`,
          lastUsedAt: now,
        },
      })
      .run();
  }
}

export type MenuStats = typeof reactionRoleStats.$inferSelect;

export async function statsFor(messageIds: string[]): Promise<MenuStats[]> {
  if (!messageIds.length) return [];
  return db.select().from(reactionRoleStats).where(inArray(reactionRoleStats.messageId, messageIds)).all();
}

/** Active temporary roles per menu. */
export async function activeTimerCounts(messageIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!messageIds.length) return counts;
  const rows = await db
    .select({ messageId: reactionRoleTimers.messageId, n: sql<number>`count(*)` })
    .from(reactionRoleTimers)
    .where(inArray(reactionRoleTimers.messageId, messageIds))
    .groupBy(reactionRoleTimers.messageId)
    .all();
  for (const r of rows) counts.set(r.messageId, Number(r.n));
  return counts;
}

/** Moves stats to a new message ID (when a menu is reposted in another channel). */
export async function moveStats(fromId: string, toId: string) {
  await db.update(reactionRoleStats).set({ messageId: toId }).where(eq(reactionRoleStats.messageId, fromId)).run();
  await db.update(reactionRoleTimers).set({ messageId: toId }).where(eq(reactionRoleTimers.messageId, fromId)).run();
}

export async function deleteStats(messageId: string) {
  await db.delete(reactionRoleStats).where(eq(reactionRoleStats.messageId, messageId)).run();
}

/* --------------------------------------------------------------- timers */

export type RoleTimer = typeof reactionRoleTimers.$inferSelect;

/** Starts (or restarts) the countdown for a temporary role. */
export async function setTimer(t: RoleTimer) {
  const { guildId, userId, roleId, ...rest } = t;
  await db
    .insert(reactionRoleTimers)
    .values(t)
    .onConflictDoUpdate({ target: [reactionRoleTimers.guildId, reactionRoleTimers.userId, reactionRoleTimers.roleId], set: rest })
    .run();
}

export async function clearTimers(guildId: string, userId: string, roleIds: string[]) {
  if (!roleIds.length) return;
  await db
    .delete(reactionRoleTimers)
    .where(and(eq(reactionRoleTimers.guildId, guildId), eq(reactionRoleTimers.userId, userId), inArray(reactionRoleTimers.roleId, roleIds)))
    .run();
}

export async function clearTimersForRole(roleId: string) {
  await db.delete(reactionRoleTimers).where(eq(reactionRoleTimers.roleId, roleId)).run();
}

export async function dueTimers(now: Date, limit = 200): Promise<RoleTimer[]> {
  return db.select().from(reactionRoleTimers).where(lte(reactionRoleTimers.expiresAt, now)).orderBy(asc(reactionRoleTimers.expiresAt)).limit(limit).all();
}

export async function deleteTimer(t: Pick<RoleTimer, "guildId" | "userId" | "roleId">) {
  await clearTimers(t.guildId, t.userId, [t.roleId]);
}
