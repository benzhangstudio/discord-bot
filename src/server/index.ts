import { config, logConfigStatus } from "./config.js";
import { startBot } from "./bot/client.js";
import { startBackups } from "./db/backup.js";
import { runMigrations } from "./db/client.js";
import { startWebServer } from "./web/server.js";

logConfigStatus();

// Startup order: database → backups → dashboard → bot.
await runMigrations();
startBackups();
await startWebServer();

if (config.skipBot) {
  console.log("[bot] SKIP_BOT is set; running the dashboard only");
} else {
  // If Discord login fails, keep the dashboard online and try again every minute.
  const login = () =>
    startBot().catch((err) => {
      console.error(`[bot] could not log in (${err.message ?? err}); retrying in 60 seconds`);
      setTimeout(login, 60_000);
    });
  await login();
}

process.on("unhandledRejection", (err) => console.error("[process] unhandled rejection:", err));
