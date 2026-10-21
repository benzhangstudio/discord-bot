# Number One: GitHub → Wispbyte

The existing Rose folder is the repository root. GitHub stores code and tests; Wispbyte runs the live bot. Your laptop is used only for development and optional temporary testing.

## One-time connection

1. Use `https://github.com/benzhangstudio/number-one.git`, branch `main`. This repository is public and contains code only; no authentication is needed to clone it. Do not upload credentials, runtime data, other project folders, or ZIP archives.
2. In Wispbyte, select a Node.js image version 24.12 or newer. Node 22 is insufficient for this build’s built-in SQLite storage.
3. Use the panel’s GitHub Integration to connect that repository with branch `main`. Enable auto-update on startup. Use Clone for the initial setup; after that, use Pull for updates. Do not clone again over your saved server-local settings or data.
4. Before the initial clone, stop the hosted bot and back up existing server files. A clone/install/reinstall operation can replace files; use the panel’s documented process for an existing server rather than deleting the server root.
5. Keep DISCORD_TOKEN and DISCORD_APPLICATION_ID in Wispbyte runtime settings, or a private server-local .env file. The production bot normally leaves DISCORD_TEST_GUILD_ID blank.
6. Install locked dependencies using `npm ci --omit=dev`. Set the startup command to `npm start`. If the panel asks only for a JavaScript filename, leave it permanently set to `src/index.js`. It loads the root server-local `.env` itself, so Wispbyte’s direct Node startup works too. The Environment page that selects `.env` is a file editor; save credentials there on Wispbyte only. Real process environment variables take priority over the private file. Never add the actual `.env` to GitHub.
7. Command registration and removal of old commands now happen automatically on startup. Watch for `Verified 6 global commands: /access, /help, /settings, /embed, /schedule, /instagram` before the online message. Startup logs the application name and ID so you can confirm which bot is being updated. The application must not have an HTTP Interactions Endpoint URL configured for this gateway bot. No switching to `src/register.js` is needed for routine setup or updates.
8. Retain the server’s `data/` directory across pulls and restarts. It contains the live database. Never synchronize the development database to production.

Official reference: https://wispbyte.com/kb/github-integration and https://wispbyte.com/kb/startup-settings. Exact controls depend on the server’s panel and runtime image. Do not assume a power restart pulls code unless its update option is configured and verified.

## Routine updates

1. Edit and test in the same local Rose folder. Publish the reviewed code to GitHub main through the connected GitHub account; no pull request is required for routine updates.
2. GitHub Actions runs syntax checks and offline tests. Wait for checks on main to pass before restarting Wispbyte. Checks do not test live Discord or Instagram.
3. Back up the live data folder and restart Number One with `AUTO_UPDATE=1`. Wispbyte pulls the configured production branch during startup. Keep the startup file at `src/index.js`; do not replace files, clone again or separately pull for routine updates. It updates and verifies the command list automatically.
4. Confirm Number One is online and try `/help`. Templates, schedules, RSVPs, and feed subscriptions remain in the server-local database.

GitHub Actions tests code; Wispbyte's configured auto-update performs deployment on restart. Do not put a GitHub token in a repository URL or commit a Wispbyte API key.

## Public dashboard and HTTPS

The existing `src/index.js` starts both the bot and the public multi-server dashboard. Keep this startup file unchanged. Wispbyte's subdomain serves `https://number-one.wispbyte.app`; Node listens on **0.0.0.0:16243** behind its HTTPS proxy. `AGE_PORT` overrides `SERVER_PORT`, which otherwise overrides the default 16243. Requests require the public Host header and `X-Forwarded-Proto: https`; plain HTTP fails closed. Dashboard errors are logged separately while the bot can continue.

The public workflow is: **Discord sign-in → choose community → configure that community on the website (if authorized) or submit a synthetic test case (if open)**. Server owners, Administrators and people with Manage Server may configure roles. Only the owner and configured reviewers can review cases. Only the current owner can access that server's audit and privacy administration. Members never need developer, GitHub or Wispbyte access.

### Operator setup, once for the whole bot

Keep your existing private `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID`. Add only the application OAuth secret to Wispbyte's existing root environment file, preserving all current lines:

```dotenv
AGE_CLIENT_SECRET=YOUR_PRIVATE_DISCORD_OAUTH_SECRET
```

In the same Discord application's OAuth2 page, register exactly `https://number-one.wispbyte.app/auth/callback`. The dashboard asks for `identify guilds` consent and uses one callback for every server. No per-server environment settings are needed. Obsolete `AGE_GUILD_ID`, `AGE_REVIEWER_ROLE_ID` and `AGE_VERIFIED_ROLE_ID` are ignored; server managers choose roles on the website.

With a nonempty client secret present, hosted startup automatically chooses Discord mode. If your private environment explicitly contains `AGE_MODE=setup`, remove that line or change it to `AGE_MODE=discord`: setup is an intentional maintenance lock. Without an application secret, sign-in remains unavailable. Never use demo mode on Wispbyte. `DASHBOARD_ENABLED=0` disables the listener if you need to roll back web hosting while keeping the bot running. `AGE_ORIGIN` defaults to the HTTPS address above; `AGE_DB` defaults to `data/age-verification.sqlite` and should remain private/persistent.

### After a GitHub update

1. Wait for checks on main to pass, then manually restart/refresh Wispbyte using the established auto-update-on-start workflow. Publishing GitHub code does not itself restart Wispbyte.
2. Leave startup at `src/index.js`. Look for `Number One dashboard listening on 0.0.0.0:16243; public verification synthetic-only with Discord sign-in.` and the normal successful bot startup. A locked message means the application secret is missing or maintenance mode is enabled. A different port means check `SERVER_PORT` or privately set `AGE_PORT=16243` to match the subdomain allocation.
3. Open `https://number-one.wispbyte.app/verify`. Sign in with Discord, approve access to your server list, and choose a community. If Number One is absent, a manager can use Add Number One to install it there.
4. On that website, choose the community's reviewer and test verified roles, acknowledge synthetic-only testing, and enable its Beta. The bot needs Manage Roles and a role above the test verified role. Use a test role that does not unlock age-restricted content; synthetic cases cannot prove real age.
5. Share the generated member link. Use a second member/reviewer account to test claims, decisions, role grant, closed-DM behavior and privacy requests. Repeat in another community and confirm data/settings remain separate. Removing membership/reviewer rights must revoke subsequent access.

The old single-server tables are not exposed under any community; their synthetic evidence is cleared, and any remaining legacy metadata stays offline for maintenance. New settings/cases use guild-scoped tables in the same private dashboard database. Existing bot data stays in its original store. See [age-verification/README.md](age-verification/README.md) for the full workflow, local demo and recovery steps. Real ID uploads/provider processing are disabled, and live Discord success must be verified after restart rather than inferred from offline tests.
## Rollback

Revert the problematic code change in GitHub, wait for checks, and pull the revert on Wispbyte. Keep a database backup from before updates that change storage formats; a code revert alone cannot reverse a future database migration. Avoid reinstalling the server to perform routine code updates.
