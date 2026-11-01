import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { announcementDeliveries, announcements, featureSettings } from "../../server/db/schema.js";
import type { AnnouncementInput, DeliveryOutcome } from "../../shared/announcements.js";

export type AnnouncementRow = typeof announcements.$inferSelect;

export const OUTCOMES: DeliveryOutcome[] = ["channel", "fallback", "skipped-off", "skipped-type", "skipped-nochannel", "failed"];

export const emptyCounts = (): Record<DeliveryOutcome, number> =>
  Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<DeliveryOutcome, number>;

export async function createAnnouncement(input: AnnouncementInput, createdBy: string): Promise<AnnouncementRow> {
  return db
    .insert(announcements)
    .values({ ...input, createdBy, createdAt: new Date(), status: "sending" })
    .returning()
    .get();
}

export const getAnnouncement = (id: number) => db.select().from(announcements).where(eq(announcements.id, id)).get();

export const listAnnouncements = (limit = 30) => db.select().from(announcements).orderBy(desc(announcements.id)).limit(limit).all();

export const unfinishedAnnouncements = () => db.select().from(announcements).where(eq(announcements.status, "sending")).all();

export async function markDone(id: number) {
  await db.update(announcements).set({ status: "done" }).where(eq(announcements.id, id)).run();
}

/** Servers already handled for this announcement, so a restart never sends one twice. */
export async function handledGuildIds(id: number): Promise<Set<string>> {
  const rows = await db
    .select({ guildId: announcementDeliveries.guildId })
    .from(announcementDeliveries)
    .where(eq(announcementDeliveries.announcementId, id))
    .all();
  return new Set(rows.map((r) => r.guildId));
}

export async function recordDelivery(announcementId: number, guildId: string, outcome: DeliveryOutcome, reason = "") {
  const values = { outcome, reason, deliveredAt: new Date() };
  await db
    .insert(announcementDeliveries)
    .values({ announcementId, guildId, ...values })
    .onConflictDoUpdate({ target: [announcementDeliveries.announcementId, announcementDeliveries.guildId], set: values })
    .run();
}

/** Outcome counts for several announcements at once, keyed by announcement ID. */
export async function countsFor(ids: number[]): Promise<Map<number, Record<DeliveryOutcome, number>>> {
  const out = new Map<number, Record<DeliveryOutcome, number>>();
  for (const id of ids) out.set(id, emptyCounts());
  if (!ids.length) return out;
  const rows = await db
    .select({ id: announcementDeliveries.announcementId, outcome: announcementDeliveries.outcome, n: sql<number>`count(*)` })
    .from(announcementDeliveries)
    .where(inArray(announcementDeliveries.announcementId, ids))
    .groupBy(announcementDeliveries.announcementId, announcementDeliveries.outcome)
    .all();
  for (const r of rows) {
    const counts = out.get(r.id);
    if (counts && r.outcome in counts) counts[r.outcome as DeliveryOutcome] = Number(r.n);
  }
  return out;
}

export const failuresFor = (id: number) =>
  db
    .select({ guildId: announcementDeliveries.guildId, reason: announcementDeliveries.reason })
    .from(announcementDeliveries)
    .where(and(eq(announcementDeliveries.announcementId, id), eq(announcementDeliveries.outcome, "failed")))
    .all();

/** Announcements that actually reached a server, newest first. */
export const receivedBy = (guildId: string, limit = 10) =>
  db
    .select({
      id: announcements.id,
      type: announcements.type,
      title: announcements.title,
      body: announcements.body,
      url: announcements.url,
      createdAt: announcements.createdAt,
      outcome: announcementDeliveries.outcome,
    })
    .from(announcementDeliveries)
    .innerJoin(announcements, eq(announcements.id, announcementDeliveries.announcementId))
    .where(and(eq(announcementDeliveries.guildId, guildId), inArray(announcementDeliveries.outcome, ["channel", "fallback"])))
    .orderBy(desc(announcements.id))
    .limit(limit)
    .all();

/** Whether the server explicitly switched announcements off (as opposed to never touching it). */
export async function isExplicitlyOff(guildId: string, featureId: string): Promise<boolean> {
  const row = await db
    .select({ enabled: featureSettings.enabled })
    .from(featureSettings)
    .where(and(eq(featureSettings.guildId, guildId), eq(featureSettings.featureId, featureId)))
    .get();
  return row?.enabled === false;
}
