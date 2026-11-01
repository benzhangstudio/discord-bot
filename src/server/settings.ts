import { and, eq } from "drizzle-orm";
import { type FeatureInfo, type FeatureState, featureCatalog } from "../shared/features.js";
import { db } from "./db/client.js";
import { featureSettings } from "./db/schema.js";

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

  const parsed = feature.settings.safeParse(row?.settings ?? {});
  return {
    id: feature.id,
    enabled: feature.alwaysOn ? true : (row?.enabled ?? false),
    settings: parsed.success ? parsed.data : feature.settings.parse({}),
  };
}

export function getAllFeatureStates(guildId: string): Promise<FeatureState[]> {
  return Promise.all(featureCatalog.map((f) => getFeatureState(guildId, f)));
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
  await db.insert(featureSettings)
    .values({ guildId, featureId: feature.id, ...values })
    .onConflictDoUpdate({ target: [featureSettings.guildId, featureSettings.featureId], set: values })
    .run();
}
