/** The status Number One shows under its name in Discord. Shared by the bot and the Developer page. */

/** How long the "coding" status can be switched on for. It always ends by itself. */
export const WORKING_HOURS = [1, 2, 4, 8] as const;
export type WorkingHours = (typeof WORKING_HOURS)[number];

export type ShownMode = "off" | "applying" | "working" | "normal";

export interface BotStatusView {
  /** The master switch: when off, the bot shows no status text at all. */
  showStatus: boolean;
  /** When the "coding" status ends (ms), or null when it's not on. */
  workingUntil: number | null;
  /** What the bot is showing right now. */
  shown: { mode: ShownMode; text: string };
}
