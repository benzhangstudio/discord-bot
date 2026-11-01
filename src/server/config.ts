import { existsSync } from "node:fs";
import { z } from "zod";

// Wispbyte's panel doesn't offer custom environment variables, so settings live in a .env file.
if (existsSync(".env")) process.loadEnvFile(".env");

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is missing"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is missing"),
  DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is missing"),
  PUBLIC_URL: z.url().transform((u) => u.replace(/\/+$/, "")),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  DEV_GUILD_ID: z.string().optional().transform((v) => v || undefined),
  // Wispbyte (Pterodactyl) exposes the allocated port as SERVER_PORT.
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default("data"),
  // Local development only: run the web dashboard without logging the bot in.
  SKIP_BOT: z.stringbool().default(false),
});

const parsed = schema.safeParse({
  ...process.env,
  PORT: process.env.SERVER_PORT || process.env.PORT || undefined,
});

if (!parsed.success) {
  console.error("Configuration problem. Check your .env file (see .env.example):");
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
