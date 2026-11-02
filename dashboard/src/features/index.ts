import type { ComponentType } from "react";
import type { GuildDetails } from "../api";
import { AutomodPanel } from "./AutomodPanel";
import { ModerationPanel } from "./ModerationPanel";
import { OnboardingPanel } from "./OnboardingPanel";
import { ReactionRolesPanel } from "./ReactionRolesPanel";

/** Extra dashboard section shown under a feature (keyed by feature ID). */
export const featurePanels: Record<string, ComponentType<{ guild: GuildDetails["guild"] }>> = {
  moderation: ModerationPanel,
  automod: AutomodPanel,
  onboarding: OnboardingPanel,
  "reaction-roles": ReactionRolesPanel,
};
