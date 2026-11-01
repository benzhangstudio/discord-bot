import { ActivityType, Events, type Client, type PresenceData } from "discord.js";

/**
 * The status under the bot's name on its Discord profile.
 *
 * Normally it shows no activity. While Claude is working on the bot it shows
 * "Playing with code" (idle). Claude turns that on by itself: at the start of each message
 * it pushes a commit saying "Claude is working…" to a branch called `bot-status` of the public repo, and a commit
 * saying "Claude is done" when it finishes replying.
 * The bot looks for that branch every few minutes (one tiny request that GitHub answers with "unchanged"
 * almost every time). If it is ever left on by mistake, the working status ends on its own after 20 minutes.
 *
 * A failed check is simply ignored, so this can never crash the bot.
 */

const MARKER_URL = "https://api.github.com/repos/benzhangstudio/number-one/branches/bot-status";
const CHECK_MS = 3 * 60_000;
const EXPIRES_MS = 20 * 60_000; // a forgotten marker stops counting after 20 minutes

// Shown as an activity under the bot's name ("Playing …"), which is how Discord lets bots show rich presence.
export const idlePresence: PresenceData = { status: "online", activities: [] };
const workingPresence: PresenceData = { status: "idle", activities: [{ name: "with code", type: ActivityType.Playing }] };

let etag: string | undefined;
let startedAt: number | null = null; // when the marker branch was last updated

async function check(client: Client) {
  try {
    const res = await fetch(MARKER_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "number-one-bot", ...(etag ? { "If-None-Match": etag } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 200) {
      const data = (await res.json()) as { commit?: { commit?: { message?: string; committer?: { date?: string } } } };
      const date = Date.parse(data.commit?.commit?.committer?.date ?? "");
      etag = res.headers.get("etag") ?? undefined;
      // The latest marker commit says "Claude is working…" while Claude is coding and "Claude is done" after.
      const on = /^claude is working/i.test(data.commit?.commit?.message ?? "");
      startedAt = on && !Number.isNaN(date) ? date : null;
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
