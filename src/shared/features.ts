import { z } from "zod";

/**
 * The single definition of every feature: its name, description and settings shape.
 * Shared by the bot (to read settings) and the dashboard (to show and edit them),
 * so the two can never disagree about what a setting is called or what values it allows.
 *
 * To add a feature: add an entry here, then a matching folder in src/features/.
 */
export interface FeatureInfo<S extends z.ZodObject = z.ZodObject> {
  id: string;
  name: string;
  description: string;
  /** Core features can't be turned off. */
  alwaysOn?: boolean;
  /** Settings shape. Every field needs a default so a fresh server works without setup. */
  settings: S;
}

const defineFeature = <S extends z.ZodObject>(info: FeatureInfo<S>) => info;

export const coreFeature = defineFeature({
  id: "core",
  name: "Core",
  description: "Basic commands like /ping and /dashboard. Always on.",
  alwaysOn: true,
  settings: z.object({}),
});

export const featureCatalog: FeatureInfo[] = [coreFeature];

export function getFeatureInfo(id: string): FeatureInfo | undefined {
  return featureCatalog.find((f) => f.id === id);
}

/** What the API returns for one feature in one server. */
export interface FeatureState {
  id: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

/** What the API returns for the server list. */
export interface DashboardGuild {
  id: string;
  name: string;
  icon: string | null;
  /** Whether the bot is already in this server. */
  botPresent: boolean;
}

export interface DashboardUser {
  id: string;
  username: string;
  avatar: string | null;
}
