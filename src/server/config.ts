import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/**
 * Settings come from the Wispbyte server, never from this repository.
 * Wispbyte's Environment page saves the variables into a private file on the server
 * (not in GitHub); values passed directly as process variables take priority over it.
 */
function loadWispbyteEnvironment() {
  const file = ".env"; // written by Wispbyte's Environment page in the server's main folder
  if (!existsSync(file)) return;
  const values = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}
loadWispbyteEnvironment();

/** First non-empty value among several possible variable names. */
function pick(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
}

const token = pick("DISCORD_TOKEN", "BOT_TOKEN", "TOKEN");
if (!token) {
  console.error("[config] DISCORD_TOKEN is missing from the Wispbyte Environment settings.");
  process.exit(1);
}

/** A bot token starts with the bot's application ID, base64-encoded. */
function clientIdFromToken(t: string): string | undefined {
  const id = Buffer.from(t.split(".")[0], "base64").toString("utf8");
  return /^\d{17,20}$/.test(id) ? id : undefined;
}

const dataDir = process.env.DATA_DIR?.trim() || "data";

/**
 * The private key that signs login cookies so they can't be forged. Never shown anywhere.
 * Created once on the server's data folder, so logins survive restarts.
 */
function loadSessionSecret(): string {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, "session-secret");
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();
    if (saved.length >= 32) return saved;
  }
  const secret = randomBytes(48).toString("hex");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  token,
  clientId: pick("DISCORD_CLIENT_ID", "DISCORD_APPLICATION_ID", "CLIENT_ID", "APPLICATION_ID") ?? clientIdFromToken(token),
  clientSecret: pick("DISCORD_CLIENT_SECRET", "CLIENT_SECRET", "AGE_CLIENT_SECRET", "OAUTH_CLIENT_SECRET"),
  /** The dashboard's public address. Detected automatically (see setPublicUrl). */
  publicUrl: pick("PUBLIC_URL", "DASHBOARD_URL")?.replace(/\/+$/, ""),
  devGuildId: pick("DEV_GUILD_ID", "DISCORD_TEST_GUILD_ID"),
  // Wispbyte gives the server's allocated port as SERVER_PORT; 16243 is this server's allocation.
  port: Number(pick("SERVER_PORT", "PORT") ?? 16243),
  dataDir,
  skipBot: pick("SKIP_BOT") === "true",
  sessionSecret: loadSessionSecret(),
};

/**
 * Records the dashboard's public address once it's known: from the redirect link registered in the
 * Discord application, or from the address people use to open the dashboard.
 */
export function setPublicUrl(url: string, source: string) {
  if (config.publicUrl) return;
  config.publicUrl = url.replace(/\/+$/, "");
  console.log(`[web] dashboard address: ${config.publicUrl} (from ${source})`);
}

/** A link to a dashboard page, or undefined while the dashboard address isn't known yet. */
export function dashboardLink(path = "") {
  return config.publicUrl ? `${config.publicUrl}${path}` : undefined;
}

export const loginReady = () => Boolean(config.clientId && config.clientSecret);

export function logConfigStatus() {
  if (!config.clientSecret) {
    console.warn("[config] Dashboard login is off: the Discord client secret isn't in the Wispbyte Environment settings.");
  }
}
