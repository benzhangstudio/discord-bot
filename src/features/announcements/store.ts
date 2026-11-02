import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { announcementDeliveries, announcements, featureSettings } from "../../server/db/schema.js";
import type { DeliveryOutcome } from "../../shared/announcements.js";

export const getAnnouncement = (id: number) => db.select().from(announcements).where(eq(announcements.id, id)).get();

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
