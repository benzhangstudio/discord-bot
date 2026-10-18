# Number One: GitHub → Wispbyte

The existing Rose folder is the repository root. GitHub stores code and tests; Wispbyte runs the live bot. Your laptop is used only for development and optional temporary testing.

## One-time connection

1. Use a private GitHub repository for this folder. Do not upload other project folders or ZIP archives.
2. In Wispbyte, select a Node.js image version 24.12 or newer. Node 22 is insufficient for this build’s built-in SQLite storage.
3. Use the panel’s GitHub Integration to connect that repository. Choose the production branch agreed during setup. Private-repository authentication should have read access to this repository only; enter it in Wispbyte, never in source files, repository URLs, or chat.
4. Before the initial clone, stop the hosted bot and back up existing server files. A clone/install/reinstall operation can replace files; use the panel’s documented process for an existing server rather than deleting the server root.
5. Keep DISCORD_TOKEN and DISCORD_APPLICATION_ID in Wispbyte runtime settings, or a private server-local .env file. Set FEED_ALLOWED_HOSTS when a feed provider is selected. The production bot normally leaves DISCORD_TEST_GUILD_ID blank.
6. Install locked dependencies using `npm ci --omit=dev`. Set the startup command to `npm start`. If the panel asks only for a JavaScript filename, it is `src/index.js`; however `npm start` is needed to load a server-local .env file. Direct `node src/index.js` works when credentials are supplied through real environment variables.
7. Register slash commands using `npm run register` once during initial setup and again when command definitions change. The application must not have an HTTP Interactions Endpoint URL configured for this gateway bot.
8. Retain the server’s `data/` directory across pulls and restarts. It contains the live database. Never synchronize the development database to production.

Official reference: https://wispbyte.com/kb/github-integration and https://wispbyte.com/kb/startup-settings. Exact controls depend on the server’s panel and runtime image. Do not assume a power restart pulls code unless its update option is configured and verified.

## Routine updates

1. Edit the same local Rose folder. Commit and push changes to a development branch.
2. GitHub Actions runs syntax checks and offline tests. Review the checks before moving the change to the production branch. Checks do not test live Discord or Instagram.
3. In a short maintenance window, stop Number One, back up the live data folder, and use Wispbyte’s Git pull/update control. Install dependencies with `npm ci --omit=dev`; register commands if their definitions changed; start Number One.
4. Confirm Number One is online and try `/help`. Templates, schedules, RSVPs, and feed subscriptions remain in the server-local database.

We can enable pull-on-start after verifying the panel supports it. This is controlled updating on restart, not a separate public web server or a laptop-hosted deployment endpoint. Do not put a GitHub token in a repository URL or commit a Wispbyte API key. This repository’s workflow tests code only; it does not deploy to Wispbyte.

## Rollback

Revert the problematic code change in GitHub, wait for checks, and pull the revert on Wispbyte. Keep a database backup from before updates that change storage formats; a code revert alone cannot reverse a future database migration. Avoid reinstalling the server to perform routine code updates.
