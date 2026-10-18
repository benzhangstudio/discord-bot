# Number One

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

Command failures produce a private error reply with a reference ID and a matching console diagnostic. Slow commands acknowledge before network work; modal-opening actions respond immediately with their form. Retired commands still cached by Discord return guidance to the current commands rather than silently timing out. An offline/disconnected bot cannot reply; check Wispbyte's online message and console if no request is logged.

## Embed builder

`/help` opens a public dropdown menu with short walkthroughs for getting started, announcements, events, weekly posts, and server settings. The instructions reflect the reader’s permissions. Anyone in the channel can choose a topic, updating the same public help message; there is nothing to configure or design.

`/embed create name:Welcome` opens a private builder. Controls edit text/color, pictures/title links, information sections, and author/small print. Colors accept names such as pink or blue as well as color codes. Optional blank values clear those properties. To replace a section, enter its position in Add or edit a section; `/embed remove-section` removes one section. Saved messages are shared by authorized staff in that server; changes save automatically.

`/embed list` shows saved names. For `/embed edit`, `/embed send`, and `/embed delete`, start typing in the message option and choose a suggestion. `/embed send` selects the destination and optional role/user notifications. User/role mentions inside the embed do not notify people. The explicit send options place notifications in the accompanying message; arbitrary mentions in saved text are suppressed. No @everyone notifications are supported.

## Scheduler

`/settings timezone` offers city suggestions such as New York or Seoul and sets the server default. Existing events retain their own timezone. `/settings staff` adds a management role; Manage Server always grants management access.

`/schedule add title:Staff meeting start:2026-12-01T19:00 channel:#staff kind:staff-meeting repeat:weekly reminder:30`

Use a future `YYYY-MM-DD HH:mm` local time with a 24-hour clock. The older format with T between the date and time and explicit timezone offsets are also accepted. Invalid or ambiguous daylight-saving times require correction. Daily/weekly repetition follows the event’s local calendar. Default duration: 60 minutes; default reminder: 30 minutes before start. Each occurrence sends one reminder, including response buttons. Reminder 0 posts at the start instead. Each event can optionally notify a role. Choose saved events by name in the event option; suggestions only show channels the requester can access.

Staff meetings and rotations require a destination hidden from @everyone. Review the channel’s other role/member access rules yourself; anyone with access to that channel can view its event details and RSVP. `/schedule list` and `/schedule show` privately display only events whose channels the requester can view.

For rotations, choose Staff rotation, Every day or Every week, and mention members in turn order in the people option. Each occurrence assigns the next person and notifies them with the reminder. All selected people must be current server members. `/schedule post` publishes an event card in the event’s channel. `/schedule edit` changes title, start, description and location; editing resets current replies. `/schedule configure` changes repetition, duration and reminder. `/schedule cancel` cancels future delivery. Existing posted cards are snapshots; `/schedule show` gives current counts/details. Old occurrence buttons stop accepting replies.

If the bot is offline during the reminder window, it catches up only while that event is still in progress. Expired occurrences are skipped; rotations advance for skipped occurrences. Number One must run continuously for reminders and autofeeds.

## RSS / autofeeds

Instagram profile links are not RSS feeds. Following an artist’s public account does not provide an authenticated Instagram integration. Obtain a provider-generated RSS/Atom URL that actually covers the posts you want. Stories and immediate delivery depend on the provider and are **not guaranteed or implemented as a direct Instagram integration**.

The bot operator adds the provider’s exact hostname to FEED_ALLOWED_HOSTS in Wispbyte variables and restarts Number One. `/feed add` selects a name, feed link, channel and optional role. Existing items are marked seen without posting a backlog. `/feed preview`, `/feed list`, `/feed pause`, `/feed resume`, and `/feed remove` manage sources; select a saved source by name in the source option.

**Weekly batches arrive Sunday at 12:00 a.m. America/New_York (the beginning of Sunday).** New items are collected once daily into the persistent database, with a final check when the batch is due. There are no individual automatic post notifications. Daylight saving is handled automatically. Empty weeks produce no message. A long batch is split into messages, with an optional role notification only on its first message. No FEED_POLL_SECONDS variable is needed; old values are ignored.

If Number One is offline at the scheduled time, one accumulated batch posts when it returns. Pausing stops collection and delivery; resuming can post an overdue batch. Provider failures postpone the batch and retry collection hourly. An uncertain Discord send pauses the feed for staff review to avoid duplicate notifications; inspect the destination before manually posting remaining items. Queued items and batch progress persist across restarts. Daily collection still depends on what the provider retains; it cannot guarantee coverage of expired Instagram stories. Feeds post titles and source links; rich Instagram media/story extraction is not included. URLs are visible only through operator storage; do not post provider secrets publicly.

HTTPS only; exact host allowlist; public DNS addresses only; no redirects; 15-second timeout; 2 MB response limit. Feed subscriptions are limited to 10 per server.

## Data and reliability

`data/rose.sqlite` persists templates, settings, schedules, RSVPs (Discord user IDs), subscriptions and delivery records. Keep it and its SQLite sidecar files private. Stop Number One before copying the data directory for a consistent simple backup. Run only one bot process against this local folder. Do not copy credentials or databases into public repositories.

Delivery records prevent repeat sends across normal restarts. Number One claims a delivery before sending. A crash or ambiguous network failure can therefore leave a **missed** notification; it is not automatically retried to avoid duplicate pings. `/settings status` reports recent uncertain/failed deliveries. Staff can manually post an event card or source link after checking the channel. This is not an exactly-once delivery guarantee. SQLite records are retained when Number One leaves a server; the operator must handle deletion requests. One reminder per occurrence; no monthly/custom recurrence, timed embed publishing, or multi-instance deployment in this first build.

## Validation

Run `npm test` for offline isolation, daylight saving, rotation, payload limits, feed restrictions, command shape and delivery deduplication checks. Run `npm run check` for the entry point syntax check.

Live checks still required: create/edit/send an embed, test a permitted role notification, schedule an event a few minutes ahead with reminder 0, test RSVPs from two members, verify a member without staff-channel access cannot view private meetings, restart to verify saved data, then test a real approved RSS feed. No live Discord or Instagram testing is performed by offline tests.
