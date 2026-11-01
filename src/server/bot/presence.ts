import { ActivityType, Events, type Client, type PresenceData } from "discord.js";

/**
 * The status under the bot's name on its Discord profile.
 *
 * Normally it shows no activity. While Claude is working on the bot it shows "Playing with code" (idle).
 * Claude turns that on by itself, on `main` like all its other work: at the start of each message it adds
 * an empty commit called "Claude is working on the bot", and when it finishes replying one called
 * "Claude is done". The bot looks at the latest commits on `main` every 3 minutes (one tiny request that
 * GitHub answers with "unchanged" almost every time). If "working" is ever left on by mistake, it stops
 * counting after 20 minutes.
 *
 * A failed check is simply ignored, so this can never crash the bot.
 */

const COMMITS_URL = "https://api.github.com/repos/benzhangstudio/number-one/commits?sha=main&per_page=20";
const CHECK_MS = 3 * 60_000;
const EXPIRES_MS = 20 * 60_000;

// Shown as an activity under the bot's name ("Playing …"), which is how Discord lets bots show rich presence.
export const idlePresence: PresenceData = { status: "online", activities: [] };
const workingPresence: PresenceData = { status: "idle", activities: [{ name: "with code", type: ActivityType.Playing }] };

type CommitList = { commit?: { message?: string; committer?: { date?: string } } }[];

let etag: string | undefined;
let startedAt: number | null = null; // when "Claude is working…" was last added to main

async function check(client: Client) {
  try {
    const res = await fetch(COMMITS_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "number-one-bot", ...(etag ? { "If-None-Match": etag } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 200) {
      etag = res.headers.get("etag") ?? undefined;
      const commits = (await res.json()) as CommitList;
      // The newest marker decides: "Claude is working…" = on, "Claude is done" = off.
      const marker = commits.find((c) => /^claude is (working|done)/i.test(c.commit?.message ?? ""));
      const date = Date.parse(marker?.commit?.committer?.date ?? "");
      const on = /^claude is working/i.test(marker?.commit?.message ?? "");
      startedAt = on && !Number.isNaN(date) ? date : null;
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
