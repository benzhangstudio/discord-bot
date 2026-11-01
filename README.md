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

## Setting it up on Wispbyte

### 1. Discord Developer Portal

At <https://discord.com/developers/applications>, open your application, then:

1. **Bot** tab → **Reset Token** and copy it (this is `DISCORD_TOKEN`).
2. **Bot** tab → turn on **Server Members Intent**. The bot won't start without it.
3. **OAuth2** tab → copy the **Client ID** and **Client Secret**.
4. **OAuth2** tab → **Redirects** → add your dashboard link followed by `/auth/callback`, for example `http://123.45.67.89:25565/auth/callback`.

### 2. Wispbyte panel

1. Get the code onto the server. If the panel's **Startup** tab has a Git repository setting, point it at this repo with auto-update on. Otherwise upload the files in the **File Manager**.
2. In the **Startup** tab, set the start file to **`index.js`** and choose **Node.js 22.13 or newer** (24 is ideal). The bot uses the database engine built into newer Node versions and will say so in the console if the version is too old.
3. In the File Manager, create a file named **`.env`** by copying `.env.example` and filling in each value. `PUBLIC_URL` is your dashboard link, with no slash at the end.
4. Start the server. The first start takes a minute or two because it installs packages and builds the dashboard.

When it works, the console shows lines like:

```
[web] dashboard running on port 25565 (http://123.45.67.89:25565)
[bot] logged in as Number One#1234 in 3 servers
```

### Backups

A copy of the database is saved every day to `data/backups/`, and the last 7 days are kept. Download them from the File Manager. To restore one, stop the server, replace `data/number-one.db` with a backup and start it again.

## How the project is organized

```
index.js                  Start file for Wispbyte
.env.example              Every setting the bot needs, explained
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
- The "Add bot" button asks for Administrator permission, since an all-in-one admin bot needs to manage roles, channels, messages and members.

## For developers

```bash
npm install                # also builds everything
npm run dev                # run the bot + API with auto-reload (uses .env)
npm run dev:dashboard      # dashboard with live reload at http://localhost:5173
npm run typecheck
npm run db:generate        # after changing src/server/db/schema.ts
```

Set `SKIP_BOT=true` in `.env` to run only the dashboard without logging the bot in.

Stack: Node.js 22.13+, TypeScript, discord.js v14, Fastify, SQLite (built into Node.js) + Drizzle ORM, React + Vite.
