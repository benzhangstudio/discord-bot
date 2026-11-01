import { ActivityType, Events, type Client, type PresenceData } from "discord.js";

/**
 * The status under the bot's name on its Discord profile.
 *
 * Normally it shows "Use /setup to get started". While Claude is working on the bot it shows
 * "Working on new features" (do not disturb). Claude turns that on by itself: at the start of a coding
 * task it pushes a branch called `bot-status` to the public repo, and deletes it when the task is done.
 * The bot looks for that branch every few minutes (one tiny request that GitHub answers with "unchanged"
 * almost every time). If the branch is ever left behind by mistake, the working status ends on its own.
 *
 * A failed check is simply ignored, so this can never crash the bot.
 */

const MARKER_URL = "https://api.github.com/repos/benzhangstudio/number-one/branches/bot-status";
const CHECK_MS = 3 * 60_000;
const EXPIRES_MS = 3 * 60 * 60_000;

const custom = (text: string) => [{ name: "Custom Status", type: ActivityType.Custom, state: text }];
export const idlePresence: PresenceData = { status: "online", activities: custom("Use /setup to get started") };
const workingPresence: PresenceData = { status: "dnd", activities: custom("Working on new features") };

let etag: string | undefined;
let startedAt: number | null = null; // when the marker branch was last updated

async function check(client: Client) {
  try {
    const res = await fetch(MARKER_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "number-one-bot", ...(etag ? { "If-None-Match": etag } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 200) {
      const data = (await res.json()) as { commit?: { commit?: { committer?: { date?: string } } } };
      const date = Date.parse(data.commit?.commit?.committer?.date ?? "");
      etag = res.headers.get("etag") ?? undefined;
      startedAt = Number.isNaN(date) ? null : date;
    } else if (res.status === 404) {
      etag = undefined;
      startedAt = null;
    } else if (res.status !== 304) {
      return; // rate limit or a GitHub hiccup: keep what we had
    }
    const working = startedAt !== null && Date.now() - startedAt < EXPIRES_MS;
    client.user?.setPresence(working ? workingPresence : idlePresence);
  } catch {
    // no internet for a moment, or Discord isn't ready: try again at the next check
  }
}

export function startPresence(client: Client) {
  client.once(Events.ClientReady, () => {
    void check(client);
    setInterval(() => void check(client), CHECK_MS);
  });
}
