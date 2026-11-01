import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { reactionRoleEntries, reactionRoleMessages } from "../../server/db/schema.js";

export type ReactionRoleMessage = typeof reactionRoleMessages.$inferSelect;
export type ReactionRoleEntry = typeof reactionRoleEntries.$inferSelect;
export type ReactionRoleConfig = ReactionRoleMessage & { entries: ReactionRoleEntry[] };

/** Discord allows at most 20 different reactions on one message. */
export const MAX_ENTRIES = 20;

export async function getConfig(messageId: string): Promise<ReactionRoleConfig | undefined> {
  const message = await db.select().from(reactionRoleMessages).where(eq(reactionRoleMessages.messageId, messageId)).get();
  if (!message) return;
  const entries = await db
    .select()
    .from(reactionRoleEntries)
    .where(eq(reactionRoleEntries.messageId, messageId))
    .orderBy(asc(reactionRoleEntries.position))
    .all();
  return { ...message, entries };
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
  return messages.map((m) => ({ ...m, entries: entries.filter((e) => e.messageId === m.messageId) }));
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
  values: Partial<Pick<ReactionRoleMessage, "title" | "description" | "singleChoice">>,
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

/** Adds or replaces the role for an emoji on a message. */
export async function setEntry(messageId: string, emojiKey: string, emojiDisplay: string, roleId: string, position: number) {
  await db
    .insert(reactionRoleEntries)
    .values({ messageId, emojiKey, emojiDisplay, roleId, position })
    .onConflictDoUpdate({
      target: [reactionRoleEntries.messageId, reactionRoleEntries.emojiKey],
      set: { roleId, emojiDisplay },
    })
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
