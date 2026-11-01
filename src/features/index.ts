import type { BotFeature } from "../server/bot/types.js";
import { core } from "./core/index.js";
import { reactionRoles } from "./reaction-roles/index.js";

/** Every feature the bot runs. Each one also needs an entry in src/shared/features.ts. */
export const features: BotFeature[] = [core, reactionRoles];
