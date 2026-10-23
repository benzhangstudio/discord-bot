# Number One

Moderation, case tracking, timeouts, automod, appeals and Critical Emergency Mode are documented in [MODERATION.md](MODERATION.md) (ban/kick/timeout DMs with an Appeal button are sent before the action; `/mod-settings set dm-appeals` and `appeal-contact` control them), including setup, permissions and recovery. Message Content Intent is optional and required only for message-based automod.

The dashboard now starts alongside the bot from the same `src/index.js`, with Wispbyte defaults for `https://number-one.wispbyte.app` on port 16243.

Run `node scripts/dump-command-text.mjs` to review every command, option and choice description.

### Dashboard

The site is a Discord-style dashboard: sign in at `/dashboard`, pick a server (servers without the bot show an invite link), then use the plugin sidebar at `/dashboard/SERVER_ID/PLUGIN`. Plugins: Overview, Moderation, Automod (owner-editable), Embeds, Scheduler, Instagram, Access, Settings (timezone editable by managers) and Verification. Moderation, Embeds, Scheduler and Instagram can be switched off per server; disabled plugins block their slash commands with a short public notice. Managers (owner, Administrator, Manage Server) see all plugins; members only see Verification. `/verify?guild=SERVER_ID` keeps working. No new environment variables are required. The root `/` is a general MEE6-style dashboard with a sidebar of plugins (Overview, Moderation, Embeds, Scheduler, Instagram, Verification, Settings). Verification lives at `/verify` as a linked feature and remains the public, multi-server synthetic Beta. Members sign in with Discord and choose their community; server owners/managers configure reviewer and test verified roles on the website. Only application credentials are configured privately once by the bot operator. See [WISPBYTE.md](WISPBYTE.md) for rollout and [age-verification/README.md](age-verification/README.md) for demo/test steps. No real ID uploads are accepted; slash-command permissions are unchanged.

One working folder for Number One. Edit and run this project in place. Slash commands only; each Discord server has separate SQLite data. No theme-bot code is used.

Production hosting is **Wispbyte**, with GitHub supplying code updates. See [WISPBYTE.md](WISPBYTE.md) for deployment and maintenance. Local startup below is for temporary testing only. GitHub Actions checks each push and pull request without using bot credentials.

## Local startup

1. Use Node.js 24.12 or newer (Node 25 is already installed on this computer).
2. Open PowerShell in this folder and run `npm install`.
3. For temporary local testing only, create a private `.env` in this folder with DISCORD_TOKEN and DISCORD_APPLICATION_ID. Optionally set DISCORD_TEST_GUILD_ID for a test server. Never commit or share `.env`. On Wispbyte, use its Environment page to save these values to the server-local `.env`.
4. In the Discord Developer Portal, use the intended Number One application. Enable Public Bot when ready for public invitations. Clear an old Interactions Endpoint URL if one is set. No privileged gateway intents are required.
5. Invite with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, and Embed Links in destinations. No Administrator permission is required. For non-mentionable role notifications, Number One also needs Mention Everyone; the invoking staff member must have it too.
6. Keep the hosted instance stopped. Run `npm start`. Startup automatically checks and updates this application's commands, removes old server-specific command overrides, and verifies the resulting list before connecting the bot. It skips rewrites when the commands already match. Other bots are not affected. It does not edit your Discord application’s display name. `npm run register` is available for a manual command-only check, but is no longer required for ordinary startup.
7. Leave PowerShell open. Stop with Ctrl+C; restart with `npm start` in this same folder.

For global/public commands, remove DISCORD_TEST_GUILD_ID and restart. Startup also clears old server-specific commands so they do not override the global definitions. Test mode only updates the selected test server; global commands are unchanged while DISCORD_TEST_GUILD_ID is set. Only enable public invitations after your test-server checks pass. Public deployment also needs your own privacy policy, support contact, and data deletion process.

Actions return a final success or user-facing error, without a technical receipt or timeout disclaimer. Fast work completes through the initial interaction response. If work lasts longer than 1.5 seconds, the bot acknowledges it within Discord’s response window, then replaces the temporary loading state with the actual result. Backend work has a shared 15-second budget; uncertain sends ask users to check the destination and are never automatically repeated. Confirmations use a separate HTTPS connection with bounded attempts. A 429 response is parsed for Retry-After/retry_after, and the same confirmation is retried only after the cooldown and within its deadline. A rate limit never triggers an immediate alternate-route attempt. Successful DM/announcement delivery is logged independently from confirmation problems. No unsolicited DM fallback is used, and private interaction tokens/URLs are never logged.

Release requirements are recorded in AGENTS.md. Before each push, inspect response paths and test never-settling backend steps and both confirmation attempts, plus permission and saved-work checks.

Every slash command is authorized at runtime for server administrators, members with Manage Server, and users approved by that Discord server’s owner. Grants are saved per server and persist across restarts. Only the current server owner can use /access add user, /access remove user, and /access list (100 grants maximum). Added people must be current human members. Removing a grant does not revoke Discord permissions. Approved users cannot grant others or bypass channel permissions. General commands are visible in Discord so approved non-managers can invoke them; ordinary members get an immediate public permission denial, and unauthorized autocomplete returns no names. /access retains Manage Server as its Discord default and also enforces owner-only access at runtime.

Normal successes and actionable errors appear publicly in the channel. Error reference IDs and technical diagnostics stay in server logs. Every reply in a server channel is public, including drafts, previews, access lists, schedules, RSVP acknowledgements and permission denials; no reply is ever dropped. Only the appeal DM flow is private. Slow commands acknowledge before network work; modal-opening actions respond immediately with their form. Retired commands still cached by Discord return guidance to the current commands rather than silently timing out. An offline/disconnected bot cannot reply; check Wispbyte's online message and console if no request is logged.

## Server portal

`/portal open` replies publicly with a button for the current server's member portal, ready to share. `/portal setup` opens that server's website setup. Both are global commands, available wherever Number One is installed after command registration on startup. Administrator, Manage Server, the current server owner, or an owner-approved command grant is required, using the same runtime rules as other commands. Unauthorized requests are denied (publicly) before options or data access.

Each community's owner/manager signs in with Discord and opens the web dashboard (`/portal open` or `/dashboard`) and configures plugins and verification roles. No per-server enablement by the bot operator is required, and the commands themselves change no settings or permissions. Website reviewer/configuration rights are checked independently; an owner-granted slash-command permission does not grant website management. Members use the shared link without needing slash-command access. Real-ID uploads remain disabled.

## Embed builder

`/help` immediately shows a public category menu. Each category lists its commands, required inputs, and one-line summaries. No DM manual is offered. Old manual buttons explain that the feature was removed and direct users to /help.

`/embed create name:Welcome` creates a saved draft and immediately opens a five-field form for the saved name, title, main text, color, and accompanying message. Submitting shows the builder. Cancelling the form leaves the starter draft available in /embed list. Controls edit text/color, pictures/title links, information sections, and author/small print. Colors accept names such as pink or blue as well as color codes. Optional blank values clear those properties. To replace a section, enter its position in Add or edit a section; `/embed remove-section` removes one section. Saved messages are shared by authorized staff in that server; changes save automatically with a last-saved timestamp. Save & close keeps the draft for /embed edit. Make a copy creates an independent draft without copying its publishing destination or notifications. Drafts persist across restarts. The builder includes channel, role, and person pickers plus Publish; notifications are revalidated before sending.

`/embed list` shows saved names. For `/embed edit`, `/embed send`, and `/embed delete`, start typing in the message option and choose a suggestion. `/embed send` selects the destination and optional role/user notifications. User/role mentions inside the embed do not notify people. The explicit send options place notifications in the accompanying message; arbitrary mentions in saved text are suppressed. No @everyone notifications are supported.

## Scheduler

`/settings timezone` offers city suggestions such as New York or Seoul and sets the server default. Existing events retain their own timezone. Every slash command, including /help and schedule viewing, requires Administrator, Manage Server, or explicit approval from the server owner. Custom staff roles alone do not grant access. The former /settings staff and /settings clear-staff commands have been retired.

`/schedule add title:Staff meeting start:2026-12-01T19:00 channel:#staff kind:staff-meeting repeat:weekly reminder:30`

Use a future `YYYY-MM-DD HH:mm` local time with a 24-hour clock. The older format with T between the date and time and explicit timezone offsets are also accepted. Invalid or ambiguous daylight-saving times require correction. Daily/weekly repetition follows the event’s local calendar. Default duration: 60 minutes; default reminder: 30 minutes before start. Each occurrence sends one reminder, including response buttons. Reminder 0 posts at the start instead. Each event can optionally notify a role. Choose saved events by name in the event option; suggestions only show channels the requester can access.

Staff meetings and rotations require a destination hidden from @everyone. Review the channel’s other role/member access rules yourself; anyone with access to that channel can view its event details and RSVP. `/schedule list` and `/schedule show` are management-only slash commands and display only accessible events. All schedule replies appear publicly in the channel where the command is used. Members can still use RSVP buttons on posted event cards; those are not slash commands.

For rotations, choose Staff rotation, Every day or Every week, and mention members in turn order in the people option. Each occurrence assigns the next person and notifies them with the reminder. All selected people must be current server members. `/schedule post` publishes an event card in the event’s channel. `/schedule edit` changes title, start, description and location; editing resets current replies. `/schedule configure` changes repetition, duration and reminder. `/schedule cancel` cancels future delivery. Existing posted cards are snapshots; `/schedule show` gives current counts/details. Old occurrence buttons stop accepting replies.

If the bot is offline during the reminder window, it catches up only while that event is still in progress. Expired occurrences are skipped; rotations advance for skipped occurrences. Number One must run continuously for reminders and autofeeds.

## Instagram roundups

Open `/instagram setup` for a setup menu. Server staff can add and manage sources without bot-owner approval. The top menu chooses a saved source or starts a new one. Channel and role pickers choose where posts go and who to notify; clear the role picker to disable notifications. Choose Daily roundup or Weekly roundup, then use Schedule for a city/timezone, 24-hour delivery time, weekly day, and optional link previews. Source edits the saved name and RSS/Atom link. Preview shows a private sample without pinging anyone or changing the queue. Choose Save to apply changes; Close discards unsaved changes. Menus expire after 30 minutes and are limited to their owner and server.

A provider-generated RSS/Atom link is still required. Number One does not scrape Instagram profiles or implement a direct Instagram integration for following artists’ public accounts. Stories depend on the provider’s coverage and retention and are not guaranteed. Profile URLs alone do not work. Staff supply the link from their chosen Instagram feed service; no FEED_ALLOWED_HOSTS variable or owner allowlist is needed. Never share private feed links publicly.

Each source has its own timezone and daily/weekly local schedule. A new source defaults to Sunday at 09:00 in the server timezone; existing sources retain their old Sunday-midnight New York schedule until staff change it. Daylight saving follows the local calendar; a nonexistent spring-forward time shifts forward by the clock change, and a repeated fall-back time produces only one roundup. Empty roundups are skipped. New sources mark existing items seen without posting a backlog. Schedule edits preserve waiting posts. Changing an account’s feed link is blocked while posts are waiting; add a separate source instead. Editing an in-progress delivery is blocked for review.

New posts are collected once daily, plus a final check when the roundup is due. Delivery is batched, with no individual automatic notifications. A long roundup splits into messages and notifies the chosen role only on its first message. No FEED_POLL_SECONDS variable is needed; old values are ignored. Daily collection depends on what the provider retains and cannot guarantee coverage of expired stories.

`/instagram list`, `/instagram preview`, `/instagram pause`, `/instagram resume`, and `/instagram remove` provide quick management; choose a saved source by name. Pausing stops collection and delivery. If the bot is offline, the accumulated roundup posts when it returns; resuming can deliver an overdue roundup. Provider failures retry hourly. An uncertain Discord send pauses delivery for staff review to avoid duplicate notifications. Check the destination before posting manually. Queued posts and delivery progress persist across restarts. The former /feed command is removed automatically on startup; saved subscriptions are retained.

Public HTTPS sources only, with public DNS addresses checked and pinned for every request. Local/private addresses, literal IPs, nonstandard ports, URL login credentials, redirects, and XML external entities are rejected. Requests have a 15-second transport limit and 2 MB response limit. Sources are limited to 10 per server. Feed URLs remain in private storage and the owner’s private setup form; keep the database out of GitHub.

## Data and reliability

`data/rose.sqlite` persists templates, settings, schedules, RSVPs (Discord user IDs), subscriptions and delivery records. Keep it and its SQLite sidecar files private. Stop Number One before copying the data directory for a consistent simple backup. Run only one bot process against this local folder. Do not copy credentials or databases into public repositories.

Delivery records prevent repeat sends across normal restarts. Number One claims a delivery before sending. A crash or ambiguous network failure can therefore leave a **missed** notification; it is not automatically retried to avoid duplicate pings. `/settings status` reports recent uncertain/failed deliveries. Staff can manually post an event card or source link after checking the channel. This is not an exactly-once delivery guarantee. SQLite records are retained when Number One leaves a server; the operator must handle deletion requests. One reminder per occurrence; no monthly/custom recurrence, timed embed publishing, or multi-instance deployment in this first build.

## Validation

Run `npm test` for offline isolation, daylight saving, rotation, payload limits, feed restrictions, command shape and delivery deduplication checks. Run `npm run check` for the entry point syntax check.

Live checks still required: create/edit/send an embed, test a permitted role notification, schedule an event a few minutes ahead with reminder 0, test RSVPs from two members, verify a member without staff-channel access cannot view private meetings, restart to verify saved data, then test a real Instagram RSS/Atom source and its configured delivery schedule. No live Discord or Instagram testing is performed by offline tests.
