import { ActivityType, Events, type Client, type PresenceData } from "discord.js";

/**
 * The status under the bot's name on its Discord profile (a cosmetic extra).
 *
 * While the bot starts up and applies changes it shows "Applying changes…" (idle).
 * A few seconds after it's ready it settles on one fixed status. Nothing here can crash the bot:
 * a failed status update is ignored.
 */

const APPLYING_MS = 20_000; // how long "Applying changes…" stays after the bot is ready

const custom = (text: string) => [{ name: "Custom Status", type: ActivityType.Custom, state: text }];

const applyingPresence: PresenceData = { status: "idle", activities: custom("Applying changes…") };
const readyPresence: PresenceData = { status: "online", activities: custom("Use /setup to get started") };

/** The status the bot logs in with, so "Applying changes…" shows from the very first moment. */
export const startupPresence = (): PresenceData => applyingPresence;

export function startPresence(client: Client) {
  client.once(Events.ClientReady, () => {
    setTimeout(() => {
      try {
        client.user?.setPresence(readyPresence);
      } catch (err) {
        console.warn("[status] couldn't update the status:", (err as Error).message);
      }
    }, APPLYING_MS);
  });
}
