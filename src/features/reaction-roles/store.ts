import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { reactionRoleEntries, reactionRoleMessages } from "../../server/db/schema.js";
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
  values: Partial<Pick<ReactionRoleMessage, "title" | "description" | "name" | "kind" | "mode" | "content" | "options" | "singleChoice">>,
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
