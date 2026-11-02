# Number One

An all-in-one Discord server administration bot. Instead of juggling several small bots, server owners add Number One and switch on the features they want from a web dashboard.

The bot and its dashboard run together as **one program** on one Wispbyte server, sharing one database file.

## What's built so far

| Piece | Status |
| --- | --- |
| Bot core: slash commands, feature on/off checks, error handling | ✅ |
| Database (SQLite) with automatic upgrades and daily backups | ✅ |
| Dashboard: "Log in with Discord", server list, per-server feature switches | ✅ |
| Commands: `/setup`, `/dashboard`, `/ping` | ✅ |
| Setup categories with recommended features | ✅ |
| Reaction roles (dashboard) | ✅ |
| Member onboarding: welcome, goodbye, join roles, steps, access gate | ✅ |
| Bot announcements: the developer broadcasts updates, maintenance and security notices to every server (dashboard → Developer) | ✅ |
| More admin features (moderation, welcome, logging…) | Next, one at a time |

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

## Features

### Commands

Number One keeps its command list short. Everything else is configured in the dashboard.

| Command | Who | What it does |
| --- | --- | --- |
| `/setup` | Manage Server | Asks what the server will use Number One for and switches on the right features |
| `/dashboard` | Manage Server | Link to this server's dashboard page |
| `/ping` | Everyone | Checks the bot is online |

### Setup

`/setup` (or the "What will you use Number One for?" card on the dashboard) lets owners pick broad categories: 🛡️ Moderation & Safety, 👥 Community & Roles, 📋 Logging & Auditing, 🎉 Engagement & Fun, and 🛠️ Utilities & Automation. The recommended features in each picked category switch on.

- Categories without features yet are marked "coming soon". When a feature ships in a picked category, it switches on automatically for that server.
- Re-running setup never switches off anything already in use.
- When Number One joins a new server, it posts a one-time welcome in the system channel with a **Set up** button.

### Member onboarding (Community & Roles)

Discord-style onboarding and welcomes **without turning on Community settings**. Configured on the dashboard; every part is optional:

| Part | Default | What it does |
| --- | --- | --- |
| Welcome message | On (system channel) | Posts in a chosen channel, as a pink card or plain text, on join or after onboarding. Placeholders: `{user}`, `{username}`, `{server}`, `{memberCount}`, `{startChannel}`. |
| Welcome DM | Off | Sends a private welcome too. |
| Goodbye message | Off | Posts when someone leaves. |
| Join roles / bot roles | None | Given right away. Bots skip onboarding. |
| Onboarding steps | Off | A Start button in a chosen channel opens a private walkthrough: rules ("I agree"), then up to 5 questions (single or multiple choice, required or optional), each answer giving up to 5 roles. With no rules or questions, members just click Finish. Members can change their answers later. |
| Access gate | Off | "Set it up for me" creates a New member role and a "Start here" category at the top with a read-only #start-here channel, and hides other channels from new members until they finish. Shows exactly what changes first; can be turned off again. New channels are hidden automatically. Optionally removes members who don't finish in time. |
| Channel access | Empty | Owner-only. **Staff categories** are never touched. **Public channels** are visible to everyone. **New-member-only channels** are visible only to members still onboarding and disappear when they finish. A **Verified role** is given when members finish. |
| Private mode | Off | Owner-only, with a two-step confirm. Gives the Verified role to everyone already in the server first, then makes every other channel visible only to Verified. Channels that are already private are left alone. Turning it off puts every channel back exactly as it was. |

- The Start card explains each step ("Answer 3 questions · 2 required, 1 optional"), what members get, and roughly how long it takes. A second card shows live numbers: members, verified, still at the gate, joined and finished this week.
- The walkthrough shows "Step 2 of 5" with a progress bar, and the last step lists the roles the member will get.
- Only "View Channel" is changed, and only for @everyone, the New member role and the Verified role. The original @everyone setting is recorded before it's changed, so it can always be restored. New channels follow the same rules automatically.
- Switching onboarding off also turns private mode off, so nobody is locked out.
- Progress is saved, so members resume where they left off, even after restarts.
- All roles are applied in one update at the end.
- People who joined while the bot was offline get their starting roles when it's back.
- The dashboard shows joins, completions and pending members, and warns if Discord's own Community features are on.
- Nobody gets stuck behind the gate: it can't be on without onboarding steps, and switching onboarding off takes the New member role off everyone still holding it.
- The dashboard warns if a join role is allowed into a channel the gate hides (in Discord, an allow beats a deny, so new members would still see it).
- **Permissions:** Manage Roles (and its role above the roles it gives); Manage Channels for the gate and private mode; Kick Members for removing unfinished members.

### Reaction roles (Community & Roles)

Members get roles by reacting to a message, and lose them by removing the reaction. Managed entirely from the dashboard:

- Create, edit and delete messages: channel, title, description, single-choice option, and emoji-to-role rows.
- Emoji picker with the server's custom emojis and common emojis. Roles the bot can't give (above its own role) are greyed out.
- **Single choice:** members can hold only one role from that message. Picking another swaps the role and clears the old reaction.
- The bot adds the reactions itself, works on old messages after restarts, ignores bot reactions, and supports custom emojis.
- Up to 20 emojis per message (Discord's limit). Changing the channel reposts the message there.
- Cleans up automatically when the message, its channel or a role is deleted. If someone clears the reactions, the bot puts its own back.
- **Permissions:** the bot needs Manage Roles, and its role must sit above the roles it gives out. In the channel it needs View Channel, Send Messages, Embed Links, Add Reactions and Read Message History. Admins can only set up roles below their own highest role. Problems are explained on save.

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
