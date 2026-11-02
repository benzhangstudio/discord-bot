import type { BotFeature } from "../server/bot/types.js";
import { automod } from "./automod/index.js";
import { core } from "./core/index.js";
import { moderation } from "./moderation/index.js";
import { onboarding } from "./onboarding/index.js";
import { reactionRoles } from "./reaction-roles/index.js";

/** Every feature the bot runs. Each one also needs an entry in src/shared/features.ts. */
export const features: BotFeature[] = [core, moderation, automod, onboarding, reactionRoles];
