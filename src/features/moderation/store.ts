import { and, desc, eq, gte, inArray, like, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { moderationCases } from "../../server/db/schema.js";
import { type CaseAction, caseActions } from "../../shared/moderation.js";

export type CaseRow = typeof moderationCases.$inferSelect;
export type NewCase = Omit<CaseRow, "id" | "caseNumber" | "logChannelId" | "logMessageId">;

const ACTIONS = new Set<string>(caseActions);
export const isAction = (a: string): a is CaseAction => ACTIONS.has(a);

/**
 * Saves a case and gives it the server's next case number.
 * The number is worked out inside the same INSERT, so two moderators acting at once can't get the same one.
 */
export async function createCase(values: NewCase): Promise<CaseRow> {
  const next = sql<number>`(select coalesce(max(${moderationCases.caseNumber}), 0) + 1 from ${moderationCases} where ${moderationCases.guildId} = ${values.guildId})`;
  const row = await db
    .insert(moderationCases)
    .values({ ...values, caseNumber: next as unknown as number })
    .returning()
    .get();
  return row;
}

export async function getCase(guildId: string, caseNumber: number): Promise<CaseRow | undefined> {
  return db
    .select()
    .from(moderationCases)
    .where(and(eq(moderationCases.guildId, guildId), eq(moderationCases.caseNumber, caseNumber)))
    .get();
}

export async function updateCase(id: number, values: Partial<Pick<CaseRow, "reason" | "active" | "logChannelId" | "logMessageId" | "dmSent">>) {
  await db.update(moderationCases).set(values).where(eq(moderationCases.id, id)).run();
}

export async function deleteCase(id: number) {
  await db.delete(moderationCases).where(eq(moderationCases.id, id)).run();
}

export async function listCases(
  guildId: string,
  opts: { userId?: string; search?: string; actions?: CaseAction[]; before?: number; limit?: number } = {},
): Promise<CaseRow[]> {
  const where = [eq(moderationCases.guildId, guildId)];
  if (opts.userId) where.push(eq(moderationCases.userId, opts.userId));
  if (opts.search) {
    const pattern = `%${opts.search.replace(/[\\%_]/g, "")}%`;
    where.push(or(like(moderationCases.userTag, pattern), like(moderationCases.moderatorTag, pattern), like(moderationCases.reason, pattern))!);
  }
  if (opts.actions?.length) where.push(inArray(moderationCases.action, opts.actions));
  if (opts.before) where.push(lt(moderationCases.caseNumber, opts.before));
  return db
    .select()
    .from(moderationCases)
    .where(and(...where))
    .orderBy(desc(moderationCases.caseNumber))
    .limit(opts.limit ?? 25)
    .all();
}

/** Warnings that still count towards automatic steps. */
export async function activeWarningCount(guildId: string, userId: string, expiryDays: number): Promise<number> {
  const where = [eq(moderationCases.guildId, guildId), eq(moderationCases.userId, userId), eq(moderationCases.action, "warn")];
  if (expiryDays > 0) where.push(gte(moderationCases.createdAt, new Date(Date.now() - expiryDays * 86_400_000)));
  const row = await db.select({ n: sql<number>`count(*)` }).from(moderationCases).where(and(...where)).get();
  return Number(row?.n ?? 0);
}

/** Ends active timeouts or temporary bans for a member (when they're lifted early or replaced). */
export async function deactivate(guildId: string, userId: string, action: "ban" | "timeout") {
  await db
    .update(moderationCases)
    .set({ active: false })
    .where(
      and(
        eq(moderationCases.guildId, guildId),
        eq(moderationCases.userId, userId),
        eq(moderationCases.action, action),
        eq(moderationCases.active, true),
      ),
    )
    .run();
}

/** Temporary bans whose time is up. */
export async function dueBans(now: Date, limit = 100): Promise<CaseRow[]> {
  return db
    .select()
    .from(moderationCases)
    .where(and(eq(moderationCases.active, true), eq(moderationCases.action, "ban"), lte(moderationCases.expiresAt, now)))
    .limit(limit)
    .all();
}

/** Timeouts end by themselves in Discord; this just tidies their "active" flag. */
export async function expireTimeouts(now: Date) {
  await db
    .update(moderationCases)
    .set({ active: false })
    .where(and(eq(moderationCases.active, true), eq(moderationCases.action, "timeout"), lte(moderationCases.expiresAt, now)))
    .run();
}

export async function stats(guildId: string) {
  const day = 86_400_000;
  const now = Date.now();
  const row = await db
    .select({
      total: sql<number>`count(*)`,
      week: sql<number>`sum(case when ${moderationCases.createdAt} >= ${now - 7 * day} then 1 else 0 end)`,
      warnings: sql<number>`sum(case when ${moderationCases.action} = 'warn' and ${moderationCases.createdAt} >= ${now - 30 * day} then 1 else 0 end)`,
      tempBans: sql<number>`sum(case when ${moderationCases.action} = 'ban' and ${moderationCases.active} = 1 then 1 else 0 end)`,
    })
    .from(moderationCases)
    .where(eq(moderationCases.guildId, guildId))
    .get();
  return {
    totalCases: Number(row?.total ?? 0),
    casesLast7Days: Number(row?.week ?? 0),
    warningsLast30Days: Number(row?.warnings ?? 0),
    activeTempBans: Number(row?.tempBans ?? 0),
  };
}

/** Counts of each action for one member (for /case history's summary line). */
export async function countsFor(guildId: string, userId: string): Promise<Partial<Record<CaseAction, number>>> {
  const rows = await db
    .select({ action: moderationCases.action, n: sql<number>`count(*)` })
    .from(moderationCases)
    .where(and(eq(moderationCases.guildId, guildId), eq(moderationCases.userId, userId)))
    .groupBy(moderationCases.action)
    .all();
  const out: Partial<Record<CaseAction, number>> = {};
  for (const r of rows) if (isAction(r.action)) out[r.action] = Number(r.n);
  return out;
}
