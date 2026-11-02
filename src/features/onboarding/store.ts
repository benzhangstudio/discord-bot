import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { featureSettings, onboardingProgress, onboardingState } from "../../server/db/schema.js";
import { getFeatureState } from "../../server/settings.js";
import { onboardingFeature } from "../../shared/features.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";

export type Progress = typeof onboardingProgress.$inferSelect;

/** The server's onboarding settings, or null when the feature is off. */
export async function getActiveSettings(guildId: string): Promise<OnboardingSettings | null> {
  const state = await getFeatureState(guildId, onboardingFeature);
  return state.enabled ? (state.settings as OnboardingSettings) : null;
}

export async function getSettings(guildId: string): Promise<OnboardingSettings> {
  return (await getFeatureState(guildId, onboardingFeature)).settings as OnboardingSettings;
}

/** Servers with onboarding switched on explicitly (used by background checks). */
export async function guildsWithOnboarding(): Promise<string[]> {
  const rows = await db
    .select({ guildId: featureSettings.guildId })
    .from(featureSettings)
    .where(and(eq(featureSettings.featureId, onboardingFeature.id), eq(featureSettings.enabled, true)))
    .all();
  return rows.map((r) => r.guildId);
}

export async function getProgress(guildId: string, userId: string): Promise<Progress | undefined> {
  return db
    .select()
    .from(onboardingProgress)
    .where(and(eq(onboardingProgress.guildId, guildId), eq(onboardingProgress.userId, userId)))
    .get();
}

export async function saveProgress(p: Progress) {
  const { guildId, userId, ...rest } = p;
  await db
    .insert(onboardingProgress)
    .values(p)
    .onConflictDoUpdate({ target: [onboardingProgress.guildId, onboardingProgress.userId], set: rest })
    .run();
}

export function newProgress(guildId: string, userId: string, joinedAt = new Date()): Progress {
  return {
    guildId,
    userId,
    status: "pending",
    step: 0,
    answers: {},
    rulesAccepted: false,
    joinedAt,
    completedAt: null,
    welcomed: false,
  };
}

export async function deleteProgress(guildId: string, userId: string) {
  await db
    .delete(onboardingProgress)
    .where(and(eq(onboardingProgress.guildId, guildId), eq(onboardingProgress.userId, userId)))
    .run();
}

/** Members who joined before `before` and still haven't finished. */
export async function unfinishedBefore(guildId: string, before: Date) {
  return db
    .select()
    .from(onboardingProgress)
    .where(and(eq(onboardingProgress.guildId, guildId), lt(onboardingProgress.joinedAt, before)))
    .all()
    .then((rows) => rows.filter((r) => r.status !== "done"));
}

export async function activity(guildId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(onboardingProgress).where(eq(onboardingProgress.guildId, guildId)).all();
  return {
    pending: rows.filter((r) => r.status !== "done").length,
    completedLast7Days: rows.filter((r) => r.completedAt && r.completedAt >= weekAgo).length,
    joinedLast7Days: rows.filter((r) => r.joinedAt >= weekAgo).length,
  };
}

export async function joinedSince(guildId: string, since: Date) {
  return db
    .select({ userId: onboardingProgress.userId })
    .from(onboardingProgress)
    .where(and(eq(onboardingProgress.guildId, guildId), gte(onboardingProgress.joinedAt, since)))
    .all();
}

export async function getState(guildId: string) {
  return db.select().from(onboardingState).where(eq(onboardingState.guildId, guildId)).get();
}

/** Saves private mode and/or the record of channels the bot changed. */
export async function saveAccessState(
  guildId: string,
  patch: Partial<Pick<typeof onboardingState.$inferInsert, "privateMode" | "managedChannels">>,
) {
  await db
    .insert(onboardingState)
    .values({ guildId, ...patch })
    .onConflictDoUpdate({ target: onboardingState.guildId, set: patch })
    .run();
}

export async function saveState(guildId: string, startChannelId: string | null, startMessageId: string | null) {
  await db
    .insert(onboardingState)
    .values({ guildId, startChannelId, startMessageId })
    .onConflictDoUpdate({ target: onboardingState.guildId, set: { startChannelId, startMessageId } })
    .run();
}
