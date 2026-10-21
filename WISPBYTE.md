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

1. Edit the same local Rose folder. Commit and push changes to a development branch.
2. GitHub Actions runs syntax checks and offline tests. Review the checks before moving the change to the production branch. Checks do not test live Discord or Instagram.
3. Back up the live data folder and restart Number One with `AUTO_UPDATE=1`. Wispbyte pulls the configured production branch during startup. Keep the startup file at `src/index.js`; do not replace files, clone again or separately pull for routine updates. It updates and verifies the command list automatically.
4. Confirm Number One is online and try `/help`. Templates, schedules, RSVPs, and feed subscriptions remain in the server-local database.

GitHub Actions tests code; Wispbyte's configured auto-update performs deployment on restart. Do not put a GitHub token in a repository URL or commit a Wispbyte API key.

## Dashboard and HTTPS rollout

The same `src/index.js` now starts the dashboard and existing Discord bot. Keep the startup setting unchanged. No additional Node process or Discord gateway connection is needed. Public defaults use `number-one.wispbyte.app` and bind **0.0.0.0:16243**, matching this server's assigned port. `AGE_PORT` overrides `SERVER_PORT`; `SERVER_PORT` overrides the default 16243. Storage is `data/age-verification.sqlite`, separate from existing bot data and retained across updates.

Wispbyte's subdomain proxy supplies the public HTTPS connection; Node serves HTTP behind it. No certificate, private key or self-signed browser certificate is shipped. The application checks the public Host header and requires `X-Forwarded-Proto: https` on hosted requests. Direct HTTP receives 426. If Wispbyte does not forward that header or preserve Host, the portal fails closed; inspect the actual proxy configuration before relaxing anything. The bot continues if web startup fails, with an actionable console error.

### First restart: public page only

1. Wait for the production GitHub checks to pass.
2. Restart in Wispbyte with auto-update enabled. Leave the JavaScript startup filename at `src/index.js`.
3. Look for `Number One dashboard listening on 0.0.0.0:16243; public verification locked pending configuration.` and the existing bot's successful startup messages. If another assigned port is in `SERVER_PORT`, the log shows that port instead. If Wispbyte still routes the subdomain to 16243, privately set `AGE_PORT=16243` in the root `.env`.
4. Visit `https://number-one.wispbyte.app`: confirm no certificate warning and a Number One dashboard instead of the Wispbyte placeholder. Open `/verify`: it must say verification is not open yet. No demo identity switcher or functional login should be exposed.
5. If the old Wispbyte placeholder remains, share the dashboard startup/error line (no secrets). If the response says unexpected host or missing HTTPS forwarding, resolve the Wispbyte proxy settings before proceeding. Code tests cannot verify the live proxy or certificate.

`AGE_MODE` defaults to `setup` in hosted startup. This serves only public pages and configuration status; all login, reviewer and submission routes return unavailable. Public demo mode is rejected. `DASHBOARD_ENABLED=0` disables the web listener for rollback without changing the bot startup file. Invalid web configuration or port conflict logs an error while the Discord bot continues.

### Second restart: Discord synthetic Beta

Do this only after the public HTTPS page is verified. Add to Wispbyte's **existing root `.env`**, preserving its current credentials (use `.env.example` as a reference, never overwrite the real file):

```dotenv
AGE_ORIGIN=https://number-one.wispbyte.app
AGE_PORT=16243
AGE_MODE=discord
AGE_CLIENT_SECRET=YOUR_DISCORD_OAUTH_CLIENT_SECRET
AGE_GUILD_ID=YOUR_ONE_SERVER_ID
AGE_REVIEWER_ROLE_ID=YOUR_CUSTOM_REVIEWER_ROLE_ID
AGE_VERIFIED_ROLE_ID=YOUR_BETA_TEST_ROLE_ID
```

The existing `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID` are reused automatically. Add the exact redirect `https://number-one.wispbyte.app/auth/callback` in the same Discord application's OAuth2 settings. Reviewer and test verified roles must differ and cannot be @everyone. The bot needs Manage Roles and a higher role than the test verified role. The server owner also receives reviewer access. Use a dedicated test role with no access to adult-only channels: synthetic approval cannot establish a real member's age.

Restart, then verify Discord sign-in, shared claims, manual minor denial, role grant and DM results using synthetic fixtures. Removing a reviewer's custom role must revoke subsequent dashboard API access. See the Beta README for exact test and recovery steps. No provider or real-ID handling is live; credentials and successful live tests are required before claiming the Discord sandbox is connected.

## Rollback

Revert the problematic code change in GitHub, wait for checks, and pull the revert on Wispbyte. Keep a database backup from before updates that change storage formats; a code revert alone cannot reverse a future database migration. Avoid reinstalling the server to perform routine code updates.
