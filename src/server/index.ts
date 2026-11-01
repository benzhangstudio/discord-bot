import { config } from "./config.js";
import { startBot } from "./bot/client.js";
import { startBackups } from "./db/backup.js";
import { runMigrations } from "./db/client.js";
import { startWebServer } from "./web/server.js";

// Startup order: database → backups → dashboard → bot.
await runMigrations();
startBackups();
await startWebServer();

if (config.SKIP_BOT) {
  console.log("[bot] SKIP_BOT is set; running the dashboard only");
} else {
  await startBot().catch((err) => {
    console.error("[bot] could not log in:", err.message ?? err);
    process.exit(1); // let Wispbyte restart the server
  });
}

process.on("unhandledRejection", (err) => console.error("[process] unhandled rejection:", err));
