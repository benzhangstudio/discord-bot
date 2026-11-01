# Number One

An all-in-one Discord server administration bot. Instead of juggling several small bots, server owners add Number One and switch on the features they want from a web dashboard.

The bot and its dashboard run together as **one program** on one Wispbyte server, sharing one database file.

## What's built so far

| Piece | Status |
| --- | --- |
| Bot core: slash commands, feature on/off checks, error handling | ✅ |
| Database (SQLite) with automatic upgrades and daily backups | ✅ |
| Dashboard: "Log in with Discord", server list, per-server feature switches | ✅ |
| Commands: `/ping`, `/dashboard` | ✅ |
| Admin features (moderation, welcome, roles, logging…) | Next, one at a time |

## Running on Wispbyte

Number One runs on Wispbyte and deploys itself on every restart:

1. Wispbyte pulls the latest code from `main` and runs `npm install`, which installs packages and builds the bot and dashboard.
2. The bot connects to Discord and registers its slash commands automatically.
3. The dashboard comes online at the server's Wispbyte subdomain (https://number-one.wispbyte.app), on the port Wispbyte assigns.

All settings (bot token, Discord client secret) live in the Wispbyte server's Environment settings. Nothing secret is stored in this repository. The dashboard address is detected automatically from the login redirect registered in the Discord application and from the address visitors use, so it never needs to be configured.

When everything is working, the console shows:

```
[web] dashboard online on port 16243
[bot] logged in as Number One#1234 in 3 servers
[bot] registered 2 global commands
[web] dashboard address: https://number-one.wispbyte.app (from Discord application settings)
```

If Discord login fails, the dashboard stays online and the bot retries every minute.

### Backups

A copy of the database is saved every day to `data/backups/`, and the last 7 days are kept. Download them from the File Manager. To restore one, stop the server, replace `data/number-one.db` with a backup and start it again.

## How the project is organized

```
index.js                  Start file for Wispbyte
src/
  shared/features.ts      The list of features and their settings, used by both the bot and the dashboard
  features/<name>/        One folder per feature: its commands and what it reacts to in Discord
  server/
    bot/                  Connects to Discord, routes commands to features
    web/                  Dashboard login and the API the dashboard talks to
    db/                   Database tables, upgrades and backups
    settings.ts           Reads and saves each server's feature settings
dashboard/                The website admins use
drizzle/                  Database upgrade files (created automatically, don't edit)
```

### How a feature is added

Each feature ships as one change containing all of its parts:

1. **Definition:** an entry in `src/shared/features.ts` with its name, description and settings, each with a sensible default.
2. **Bot behavior:** a folder in `src/features/` with its commands and event handlers.
3. **Dashboard page:** its settings form in `dashboard/`.
4. **Database tables**, only if it needs to store records such as warnings or tickets.

Features start **off** in every server until an admin turns them on. If someone uses a command from a disabled feature, the bot tells them where to enable it.

### Security

- Only people with **Manage Server** can open a server's dashboard page. This is re-checked with Discord on every request, so removing someone's permission takes effect immediately.
- Settings are checked against each feature's rules before saving, so the dashboard can't store invalid values.
- Login sessions last up to 7 days. The browser only holds a random, signed ID, and the Discord login details stay in the database.
- The key that signs login cookies is generated automatically on first start and stored in `data/session-secret` on the server. It's never shown or uploaded anywhere.
- The "Add bot" button asks for Administrator permission, since an all-in-one admin bot needs to manage roles, channels, messages and members.

## For developers

```bash
npm install                # also builds everything
npm run dev                # run the bot + API with auto-reload
npm run dev:dashboard      # dashboard with live reload at http://localhost:5173
npm run typecheck
npm run db:generate        # after changing src/server/db/schema.ts
```

Settings come from environment variables. Set `SKIP_BOT=true` to run only the dashboard without logging the bot in.

Stack: Node.js 22.13+ (the server runs Node 26), TypeScript, discord.js v14, Fastify, SQLite (built into Node.js) + Drizzle ORM, React + Vite.
