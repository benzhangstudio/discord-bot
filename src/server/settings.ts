import { and, eq } from "drizzle-orm";
import {
  type CategoryId,
  type FeatureInfo,
  type FeatureState,
  type SetupState,
  categoryIds,
  featureCatalog,
  legacyCategories,
} from "../shared/features.js";
import { db } from "./db/client.js";
import { featureSettings, guildSetup } from "./db/schema.js";

/** A server's /setup answers (empty if it hasn't run setup yet). */
export async function getSetup(guildId: string): Promise<SetupState> {
  const row = await db.select().from(guildSetup).where(eq(guildSetup.guildId, guildId)).get();
  const valid = new Set<string>(categoryIds);
  return {
    categories: [...new Set((row?.categories ?? []).map((c) => legacyCategories[c] ?? c))].filter((c): c is CategoryId =>
      valid.has(c),
    ),
    completed: Boolean(row?.completedAt),
  };
}

function resolveState(feature: FeatureInfo, row: typeof featureSettings.$inferSelect | undefined, setup: SetupState): FeatureState {
  const parsed = feature.settings.safeParse(row?.settings ?? {});
  // Without an explicit on/off choice, a recommended feature is on when its category was picked in /setup.
  const byDefault = Boolean(feature.recommended && feature.category && setup.categories.includes(feature.category));
  return {
    id: feature.id,
    // Work-in-progress features are off everywhere until they're finished; saved choices are kept for later.
    enabled: feature.alwaysOn ? true : feature.workInProgress ? false : (row?.enabled ?? byDefault),
    settings: parsed.success ? parsed.data : feature.settings.parse({}),
  };
}

/**
 * Reads a feature's on/off state and settings for one server.
 * Missing or outdated settings are filled in from the feature's defaults.
 */
export async function getFeatureState(guildId: string, feature: FeatureInfo): Promise<FeatureState> {
  const row = await db
    .select()
    .from(featureSettings)
    .where(and(eq(featureSettings.guildId, guildId), eq(featureSettings.featureId, feature.id)))
    .get();
  return resolveState(feature, row, await getSetup(guildId));
}

export async function getAllFeatureStates(guildId: string): Promise<FeatureState[]> {
  const [rows, setup] = await Promise.all([
    db.select().from(featureSettings).where(eq(featureSettings.guildId, guildId)).all(),
    getSetup(guildId),
  ]);
  return featureCatalog.map((f) => resolveState(f, rows.find((r) => r.featureId === f.id), setup));
}

export async function isFeatureEnabled(guildId: string, feature: FeatureInfo): Promise<boolean> {
  return (await getFeatureState(guildId, feature)).enabled;
}

/** Saves a feature's state. Settings must already be validated against the feature's schema. */
export async function saveFeatureState(
  guildId: string,
  feature: FeatureInfo,
  state: { enabled: boolean; settings: Record<string, unknown> },
  updatedBy: string,
) {
  const values = {
    enabled: feature.alwaysOn ? true : state.enabled,
    settings: state.settings,
    updatedAt: new Date(),
    updatedBy,
  };
  await db
    .insert(featureSettings)
    .values({ guildId, featureId: feature.id, ...values })
    .onConflictDoUpdate({ target: [featureSettings.guildId, featureSettings.featureId], set: values })
    .run();
}

/**
 * Saves the categories a server picked and switches on the recommended features in them.
 * Features the server already uses are left alone, so re-running setup never turns anything off.
 * Returns the features that were switched on by this call.
 */
export async function applySetup(guildId: string, picked: CategoryId[], userId: string): Promise<FeatureInfo[]> {
  const categories = [...new Set(picked)].filter((c) => categoryIds.includes(c));
  const before = await getAllFeatureStates(guildId); // to report what actually changed
  const now = new Date();
  await db
    .insert(guildSetup)
    .values({ guildId, categories, completedAt: now, completedBy: userId })
    .onConflictDoUpdate({ target: guildSetup.guildId, set: { categories, completedAt: now, completedBy: userId } })
    .run();

  const turnedOn: FeatureInfo[] = [];
  for (const feature of featureCatalog) {
    if (!feature.recommended || !feature.category || feature.workInProgress || !categories.includes(feature.category)) continue;
    const current = before.find((s) => s.id === feature.id)!;
    const row = await db
      .select({ enabled: featureSettings.enabled })
      .from(featureSettings)
      .where(and(eq(featureSettings.guildId, guildId), eq(featureSettings.featureId, feature.id)))
      .get();
    if (row?.enabled) continue; // already switched on
    // Save it as "on" explicitly, so un-picking the category later doesn't switch it off.
    await saveFeatureState(guildId, feature, { enabled: true, settings: current.settings }, userId);
    if (!current.enabled) turnedOn.push(feature);
  }
  return turnedOn;
}

/** Records that the "thanks for adding me" message was sent. Returns false if it already was. */
export async function markWelcomed(guildId: string): Promise<boolean> {
  const row = await db.select({ welcomedAt: guildSetup.welcomedAt }).from(guildSetup).where(eq(guildSetup.guildId, guildId)).get();
  if (row?.welcomedAt) return false;
  await db
    .insert(guildSetup)
    .values({ guildId, welcomedAt: new Date() })
    .onConflictDoUpdate({ target: guildSetup.guildId, set: { welcomedAt: new Date() } })
    .run();
  return true;
}
