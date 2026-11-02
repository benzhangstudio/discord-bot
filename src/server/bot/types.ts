import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  ClientEvents,
  MessageComponentInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { FeatureInfo } from "../../shared/features.js";

/**
 * A slash command. Replies are PUBLIC by default, so staff can see who used which command.
 * Only use private (ephemeral) replies for errors, permission denials, or a member's personal steps.
 */
export interface SlashCommand {
  /** Built with discord.js's SlashCommandBuilder. */
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
  /** Suggestions while the user is typing an option marked with setAutocomplete(true). */
  autocomplete?(interaction: AutocompleteInteraction): Promise<unknown>;
}

/** Handles buttons and menus whose custom ID starts with `${prefix}:`. */
export interface ComponentHandler {
  prefix: string;
  handle(interaction: MessageComponentInteraction): Promise<unknown>;
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
  components?: ComponentHandler[];
  /** Optional one-time setup when the bot starts (timers, caches...). */
  setup?(client: Client): void;
  /** Optional dashboard API routes for this feature (already limited to people who manage the server). */
  registerApi?(api: FeatureApi): void;
  /** Optional: runs after an admin switches the feature on or off in the dashboard. */
  onToggle?(guildId: string, enabled: boolean): Promise<unknown>;
  /** Optional: undo changes made inside Discord before the owner deletes the server's data and Number One leaves. */
  beforeDataDelete?(guildId: string): Promise<unknown>;
}

export type FeatureApi = import("fastify").FastifyInstance;
