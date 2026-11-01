import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ActivityType, Events, type Client, type PresenceData } from "discord.js";
import type { BotStatusView, ShownMode, WorkingHours } from "../../shared/botStatus.js";
import { config } from "../config.js";

/**
 * The bot's live status under its name in Discord (a cosmetic extra).
 *
 *  - While starting up it shows "Applying changes…" (idle), then switches to its normal status.
 *  - The developer can switch on a "Coding new features" status (do not disturb) from the Developer page.
 *    It ends by itself, and survives restarts, so it still shows while the bot restarts to apply changes.
 *  - Otherwise it rotates between a couple of friendly lines.
 *
 * Nothing here can crash the bot: every Discord call is wrapped, and the saved file is optional.
 */

interface Saved {
  showStatus: boolean;
  workingUntil: number | null;
}

const FILE = join(config.dataDir, "bot-status.json");
const ROTATE_MS = 10 * 60_000; // far below Discord's limit of ~5 status changes per 20 seconds
const APPLYING_MS = 20_000; // how long "Applying changes…" stays after the bot is ready

function load(): Saved {
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Saved>;
    return {
      showStatus: raw.showStatus !== false,
      workingUntil: typeof raw.workingUntil === "number" && raw.workingUntil > Date.now() ? raw.workingUntil : null,
    };
  } catch {
    return { showStatus: true, workingUntil: null };
  }
}

function save() {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(FILE, JSON.stringify(saved));
  } catch (err) {
    console.warn("[status] couldn't save the bot status:", (err as Error).message);
  }
}

let saved: Saved = load();
let applying = true;
let rotation = 0;
let botClient: Client | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

const custom = (text: string) => [{ name: "Custom Status", type: ActivityType.Custom, state: text }];

function working() {
  if (saved.workingUntil && saved.workingUntil <= Date.now()) {
    saved.workingUntil = null;
    save();
  }
  return saved.workingUntil;
}

function normalText() {
  const n = botClient?.guilds.cache.size ?? 0;
  const lines = [n > 0 ? `Watching over ${n} server${n === 1 ? "" : "s"}` : "Watching over your servers", "Use /setup to get started"];
  return lines[rotation % lines.length];
}

function current(): { mode: ShownMode; text: string; presence: PresenceData } {
  if (!saved.showStatus) return { mode: "off", text: "", presence: { status: "online", activities: [] } };
  if (applying) {
    const text = "Applying changes…";
    return { mode: "applying", text, presence: { status: "idle", activities: custom(text) } };
  }
  if (working()) {
    const text = "Coding new features";
    return { mode: "working", text, presence: { status: "dnd", activities: custom(text) } };
  }
  const text = normalText();
  return { mode: "normal", text, presence: { status: "online", activities: custom(text) } };
}

/** The status the bot should log in with, so "Applying changes…" shows from the very first moment. */
export function startupPresence(): PresenceData {
  return current().presence;
}

function push() {
  try {
    botClient?.user?.setPresence(current().presence);
  } catch (err) {
    console.warn("[status] couldn't update the status:", (err as Error).message);
  }
}

/** Updates the status now, and plans the next update (rotation, or when the coding status ends). */
function refresh() {
  if (timer) clearTimeout(timer);
  push();
  const until = working();
  const wait = until ? Math.min(ROTATE_MS, Math.max(5_000, until - Date.now() + 1_000)) : ROTATE_MS;
  timer = setTimeout(() => {
    rotation++;
    refresh();
  }, wait);
}

export function startPresence(client: Client) {
  botClient = client;
  client.once(Events.ClientReady, () => {
    push(); // still "Applying changes…" while commands register
    setTimeout(() => {
      applying = false;
      refresh();
    }, APPLYING_MS);
  });
}

export function statusView(): BotStatusView {
  const { mode, text } = current();
  return { showStatus: saved.showStatus, workingUntil: working(), shown: { mode, text } };
}

export function updateStatus(patch: { showStatus?: boolean; workingHours?: WorkingHours | null }): BotStatusView {
  if (patch.showStatus !== undefined) saved.showStatus = patch.showStatus;
  if (patch.workingHours !== undefined) {
    saved.workingUntil = patch.workingHours === null ? null : Date.now() + patch.workingHours * 3_600_000;
  }
  save();
  if (!applying) refresh();
  else push();
  return statusView();
}
