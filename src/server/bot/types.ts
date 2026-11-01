import type {
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { FeatureInfo } from "../../shared/features.js";

export interface SlashCommand {
  /** Built with discord.js's SlashCommandBuilder. */
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
}

export interface FeatureEvent<E extends keyof ClientEvents = keyof ClientEvents> {
  event: E;
  /** Runs for every matching event. Use isFeatureEnabled() to skip servers where the feature is off. */
  handle(...args: ClientEvents[E]): Promise<unknown> | unknown;
}

/** Helper that keeps the event name and handler arguments in sync. */
export const onEvent = <E extends keyof ClientEvents>(
  event: E,
  handle: (...args: ClientEvents[E]) => Promise<unknown> | unknown,
): FeatureEvent => ({ event, handle }) as FeatureEvent;

/** The bot-side half of a feature (the shared half lives in src/shared/features.ts). */
export interface BotFeature {
  info: FeatureInfo;
  commands?: SlashCommand[];
  events?: FeatureEvent[];
  /** Optional one-time setup when the bot starts (timers, caches...). */
  setup?(client: Client): void;
}
