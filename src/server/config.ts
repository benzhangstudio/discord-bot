import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Settings come from the variables set in the Wispbyte panel (Startup tab).
 * Only DISCORD_TOKEN is required; everything else is optional or worked out automatically.
 */
const schema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1),
  // Optional: worked out from the token when not set.
  DISCORD_CLIENT_ID: z.string().trim().optional(),
  // Needed only for dashboard login ("Log in with Discord").
  DISCORD_CLIENT_SECRET: z.string().trim().optional(),
  // The dashboard's public address. Falls back to Wispbyte's server address and port.
  PUBLIC_URL: z.string().trim().optional(),
  // Optional: a test server ID where slash commands update instantly.
  DEV_GUILD_ID: z.string().trim().optional(),
  // Wispbyte (Pterodactyl) provides the allocated address and port automatically.
  SERVER_IP: z.string().trim().optional(),
  SERVER_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  DATA_DIR: z.string().default("data"),
  // Local development only: run the web dashboard without logging the bot in.
  SKIP_BOT: z.stringbool().default(false),
});

const emptyToUndefined = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);
const parsed = schema.safeParse(emptyToUndefined);
if (!parsed.success) {
  console.error("[config] DISCORD_TOKEN is missing. Add it as a variable in the Wispbyte panel (Startup tab).");
  process.exit(1);
}
const env = parsed.data;

/** A bot token starts with the bot's user ID (which is also its application ID), base64-encoded. */
function clientIdFromToken(token: string): string | undefined {
  try {
    const id = Buffer.from(token.split(".")[0], "base64").toString("utf8");
    return /^\d{17,20}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

function resolvePublicUrl(): string | undefined {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  if (env.SERVER_IP && env.SERVER_PORT && env.SERVER_IP !== "0.0.0.0") return `http://${env.SERVER_IP}:${env.SERVER_PORT}`;
  return undefined;
}

/**
 * The key that signs login cookies so they can't be forged. It's private and never shown anywhere.
 * Created once and kept in the data folder, so logins survive restarts.
 */
function loadSessionSecret(dataDir: string): string {
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

const publicUrl = resolvePublicUrl();
const clientId = env.DISCORD_CLIENT_ID || clientIdFromToken(env.DISCORD_TOKEN);

export const config = {
  token: env.DISCORD_TOKEN,
  clientId,
  clientSecret: env.DISCORD_CLIENT_SECRET,
  publicUrl,
  devGuildId: env.DEV_GUILD_ID,
  port: env.SERVER_PORT ?? env.PORT ?? 3000,
  dataDir: env.DATA_DIR,
  skipBot: env.SKIP_BOT,
  sessionSecret: loadSessionSecret(env.DATA_DIR),
  /** True when everything "Log in with Discord" needs is set. */
  loginReady: Boolean(clientId && env.DISCORD_CLIENT_SECRET && publicUrl),
};

/** A link to a dashboard page, or undefined when the dashboard address isn't known. */
export function dashboardLink(path = "") {
  return config.publicUrl ? `${config.publicUrl}${path}` : undefined;
}

/** Explains at startup which optional settings are missing and what that turns off. */
export function logConfigStatus() {
  const missing: string[] = [];
  if (!config.clientSecret) missing.push("DISCORD_CLIENT_SECRET (Developer Portal → OAuth2 → Client Secret)");
  if (!config.publicUrl) missing.push("PUBLIC_URL (your dashboard link, e.g. http://123.45.67.89:25565)");
  if (!config.clientId) missing.push("DISCORD_CLIENT_ID (couldn't be read from the token)");
  if (missing.length) {
    console.warn("[config] The bot will run, but dashboard login is off until these Wispbyte variables are added:");
    for (const m of missing) console.warn(`  - ${m}`);
  } else {
    console.log(`[config] dashboard login ready. Redirect URL to add in the Developer Portal: ${config.publicUrl}/auth/callback`);
  }
}
