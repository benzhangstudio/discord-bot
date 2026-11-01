import type { ComponentType } from "react";
import type { GuildDetails } from "../api";
import { OnboardingPanel } from "./OnboardingPanel";
import { ReactionRolesPanel } from "./ReactionRolesPanel";

/** Extra dashboard section shown under a feature (keyed by feature ID). */
export const featurePanels: Record<string, ComponentType<{ guild: GuildDetails["guild"] }>> = {
  onboarding: OnboardingPanel,
  "reaction-roles": ReactionRolesPanel,
};
