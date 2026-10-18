# Number One

One working folder for Number One. Edit and run this project in place. Slash commands only; each Discord server has separate SQLite data. No theme-bot code is used.

Production hosting is **Wispbyte**, with GitHub supplying code updates. See [WISPBYTE.md](WISPBYTE.md) for deployment and maintenance. Local startup below is for temporary testing only. GitHub Actions checks each push and pull request without using bot credentials.

## Local startup

1. Use Node.js 24.12 or newer (Node 25 is already installed on this computer).
2. Open PowerShell in this folder and run `npm install`.
3. Copy `.env.example` to `.env` **once** and fill in the bot token, application ID, and your test Discord server ID. Never share `.env`.
4. In the Discord Developer Portal, use the intended Number One application. Enable Public Bot when ready for public invitations. Clear an old Interactions Endpoint URL if one is set. No privileged gateway intents are required.
5. Invite with `bot` and `applications.commands` scopes. Grant View Channels, Send Messages, and Embed Links in destinations. No Administrator permission is required. For non-mentionable role notifications, Number One also needs Mention Everyone; the invoking staff member must have it too.
6. Keep the hosted instance stopped. Run `npm run register`, then `npm start`. Registration replaces this application's old commands with the current command set. Global registration also removes this application's server-specific command overrides in servers the bot has joined. Other bots are not affected. It does not edit your Discord application’s display name.
7. Leave PowerShell open. Stop with Ctrl+C; restart with `npm start` in this same folder.

For global/public commands, remove DISCORD_TEST_GUILD_ID and run `npm run register` again. This also clears old server-specific commands so they do not override the global definitions. Only enable public invitations after your test-server checks pass. Public deployment also needs your own privacy policy, support contact, and data deletion process.

Command failures produce a private error reply with a reference ID and a matching console diagnostic. Slow commands acknowledge before network work; modal-opening actions respond immediately with their form. Retired commands still cached by Discord return guidance to the current commands rather than silently timing out. An offline/disconnected bot cannot reply; check Wispbyte's online message and console if no request is logged.

## Embed builder

`/embed create name:Welcome` opens a private builder. Buttons edit text/color, images/title links, fields, and author/footer. Optional blank values clear those properties. To replace a field, enter its number in Add field; `/embed remove-field` removes one field. Saved templates are shared by authorized staff in that server; changes save automatically.

`/embed list` gives IDs; `/embed edit` reopens one. `/embed send` selects the destination and optional role/user notifications. Channel mentions use `<#CHANNEL_ID>`. User/role mentions inside the embed do not notify people. The explicit send options place notifications in the accompanying message; arbitrary mentions in saved text are suppressed. No @everyone notifications are supported.

## Scheduler

`/settings timezone zone:America/New_York` sets the server default. Existing events retain their own timezone. `/settings staff` adds a management role; Manage Server always grants management access.

`/schedule add title:Staff meeting start:2026-12-01T19:00 channel:#staff kind:staff-meeting repeat:weekly reminder:30`

Use a future `YYYY-MM-DDTHH:mm` local time, or include an explicit ISO timezone offset. Invalid or ambiguous daylight-saving times require correction. Daily/weekly recurrence follows the event’s local calendar. Default duration: 60 minutes; default reminder: 30 minutes before start. Each occurrence sends one reminder, including RSVP buttons. Reminder 0 posts at the start instead. Each event can optionally notify a role.

Staff meetings and rotations require a destination hidden from @everyone. Review the channel’s other role/member access rules yourself; anyone with access to that channel can view its event details and RSVP. `/schedule list` and `/schedule show` privately display only events whose channels the requester can view.

For rotations, choose kind `rotation`, daily/weekly recurrence, and supply ordered user IDs or @mentions in `assignees`. Each occurrence assigns the next person and notifies them with the reminder. All assignees must be current server members. `/schedule post` publishes an event/RSVP card in the event’s channel. `/schedule edit` changes title, start, description and location; editing resets current RSVPs. `/schedule configure` changes recurrence, duration and reminder. `/schedule cancel` cancels future delivery. Existing posted cards are snapshots; `/schedule show` gives current counts/details. Old occurrence buttons stop accepting RSVPs.

If the bot is offline during the reminder window, it catches up only while that event is still in progress. Expired occurrences are skipped; rotations advance for skipped occurrences. Number One must run continuously for reminders and autofeeds.

## RSS / autofeeds

Instagram profile links are not RSS feeds. Following an artist’s public account does not provide an authenticated Instagram integration. Obtain a provider-generated RSS/Atom URL that actually covers the posts you want. Stories and immediate delivery depend on the provider and are **not guaranteed or implemented as a direct Instagram integration**.

The bot operator adds the provider’s exact hostname to FEED_ALLOWED_HOSTS in Wispbyte variables and restarts Number One. `/feed add` selects a label, URL, channel and optional role. Existing items are marked seen without posting a backlog. `/feed preview`, `/feed list`, `/feed pause`, `/feed resume`, and `/feed remove` manage subscriptions.

**Weekly batches arrive Sunday at 12:00 a.m. America/New_York (the beginning of Sunday).** New items are collected once daily into the persistent database, with a final check when the batch is due. There are no individual automatic post notifications. Daylight saving is handled automatically. Empty weeks produce no message. A long batch is split into messages, with an optional role notification only on its first message. No FEED_POLL_SECONDS variable is needed; old values are ignored.

If Number One is offline at the scheduled time, one accumulated batch posts when it returns. Pausing stops collection and delivery; resuming can post an overdue batch. Provider failures postpone the batch and retry collection hourly. An uncertain Discord send pauses the feed for staff review to avoid duplicate notifications; inspect the destination before manually posting remaining items. Queued items and batch progress persist across restarts. Daily collection still depends on what the provider retains; it cannot guarantee coverage of expired Instagram stories. Feeds post titles and source links; rich Instagram media/story extraction is not included. URLs are visible only through operator storage; do not post provider secrets publicly.

HTTPS only; exact host allowlist; public DNS addresses only; no redirects; 15-second timeout; 2 MB response limit. Feed subscriptions are limited to 10 per server.

## Data and reliability

`data/rose.sqlite` persists templates, settings, schedules, RSVPs (Discord user IDs), subscriptions and delivery records. Keep it and its SQLite sidecar files private. Stop Number One before copying the data directory for a consistent simple backup. Run only one bot process against this local folder. Do not copy credentials or databases into public repositories.

Delivery records prevent repeat sends across normal restarts. Number One claims a delivery before sending. A crash or ambiguous network failure can therefore leave a **missed** notification; it is not automatically retried to avoid duplicate pings. `/settings status` reports recent uncertain/failed deliveries. Staff can manually post an event card or source link after checking the channel. This is not an exactly-once delivery guarantee. SQLite records are retained when Number One leaves a server; the operator must handle deletion requests. One reminder per occurrence; no monthly/custom recurrence, timed embed publishing, or multi-instance deployment in this first build.

## Validation

Run `npm test` for offline isolation, daylight saving, rotation, payload limits, feed restrictions, command shape and delivery deduplication checks. Run `npm run check` for the entry point syntax check.

Live checks still required: create/edit/send an embed, test a permitted role notification, schedule an event a few minutes ahead with reminder 0, test RSVPs from two members, verify a member without staff-channel access cannot view private meetings, restart to verify saved data, then test a real approved RSS feed. No live Discord or Instagram testing is performed by offline tests.
