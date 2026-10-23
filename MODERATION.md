# Number One moderation

This module runs inside the existing bot and uses its server-scoped SQLite store. It implements moderation commands, persistent cases and warning history, native Discord timeouts, kicks, bans/unbans, recent-message purges, message filters, private case logs, member appeals, and a reversible Critical Emergency Mode. It does not claim Dyno feature parity or live Discord verification.

## Wispbyte setup

1. Keep the production branch at `main`, `AUTO_UPDATE=1`, startup file `src/index.js`, and Node 24.12 or newer. Back up `data/` before restarting after the GitHub checks pass. Keep the live database and private `.env` on Wispbyte.
2. In Discord, put Number One above the members it must moderate. Give it View Channels, Send Messages, Moderate Members, Kick Members, Ban Members, Manage Messages and Read Message History as needed. Critical Emergency Mode additionally needs Manage Roles for channel overwrites. Administrator is not required. Server 2FA requirements still apply.
3. Create a private staff log channel. Deny View Channel to @everyone, grant only trusted staff and Number One access, and audit all other role/member overwrites. Configure `/mod-settings set log-channel:#mod-log` as the server owner. Review channel permissions regularly; the bot checks @everyone visibility before each log send, but cannot establish your organizational confidentiality policy.
4. For staff without Administrator or Manage Server, the current owner first uses `/access add user:...`. The owner may then configure `mod-role` using `/mod-settings set`. A role alone never bypasses Number One command authorization. A staff member also needs either the relevant native moderation permission or the configured moderation role. Manage Server alone does not confer moderation powers.
5. Optional message filters need `MODERATION_MESSAGE_CONTENT=1` in Wispbyte and Message Content Intent enabled in the Discord Developer Portal, followed by a restart. Then enable `/mod-settings set automod:true`. Without that option, moderation slash commands work without privileged intents. No Guild Members intent is requested; individual members are fetched as needed.
6. Set `blocked-words` (comma-separated literal phrases), `mention-limit`, `spam-limit`, `block-invites` and `retention-days` through `/mod-settings set`. Defaults: filters off, mention limit 8, six messages per ten seconds, invites blocked when filters are enabled, retention 365 days. Set automod false to stop enforcement immediately.
7. Post `/appeals panel channel:#appeals` for members still in the server. Banned, kicked and timed-out members get an **Appeal** button by DM automatically. Optionally set `/mod-settings set appeal-contact:` (link or email) as a fallback for members whose DMs are closed.

Startup registers familiar standalone moderation commands including `/ban`, `/kick`, `/warn`, `/mute`, `/timeout`, `/purge`, `/warnings` and `/modlogs`. The old `/mod` group is retired automatically. `/help` groups moderation actions together and lists required inputs. Case fields offer suggestions by member, action, reason or ID. No token, database migration command or replacement upload is required for this update.

## Everyday workflow

| Command | Behavior |
| --- | --- |
| `/warn user reason` | Record a warning without changing roles or Discord permissions. |
| `/timeout user duration` or `/mute user duration` | Native Discord timeout; use `10m`, `1h`, `1d` or `1w`, up to 28 days. Reason is optional. Discord expires it even if the bot is offline. |
| `/untimeout user reason` | Remove the native timeout. |
| `/kick user reason` | Remove a current member. Does not prevent rejoining. |
| `/ban user reason` | Ban a current member without deleting their previous messages. |
| `/unban user reason` | Remove an existing ban; does not automatically rejoin the member. |
| `/purge count` | Scan up to 100 recent messages in this text/announcement channel; skip pinned and nearly fourteen-day-old messages. Optional `user` filters to one member; optional `reason` records context. No extra confirmation text is required. |
| `/warnings user page` | Show a member’s active warnings. |
| `/modlogs user page` | Page through cases for a member, including voided warnings. |
| `/case id` | Show the case, outcome and recent staff notes. |
| `/reason case reason` | Append a staff note. |
| `/delwarn case reason` | Void an active warning while retaining its original reason/history. It does not reverse a sanction. |
| `/mod-settings view` | Show policy, log delivery issues and unresolved case IDs. |

Member actions protect the owner, bot accounts, administrators, configured moderators, the invoking moderator, and members at or above Number One's role. Non-owner moderators also cannot act on peers or higher roles. Actual Discord mutations refresh permissions, owner and role hierarchy during preflight. Local warnings, notes and case-history operations use signed interaction and complete guild-role data, finishing through one initial reply without unnecessary REST lookups or deferral. Missing role data fails closed. Warnings and case notes require a reason; common sanctions accept an optional reason and record “No reason provided” if omitted. `/unmute` aliases `/untimeout`. Stored/rendered text cannot trigger mentions. Moderation and appeal replies are public in the channel where staff run the command (use staff channels); the appeal panel is intentionally posted publicly to its selected channel.

### Member DMs (`dm` option)

`/ban`, `/kick`, `/warn`, `/timeout`/`/mute`, `/untimeout`/`/unmute` and `/unban` take an optional `dm` boolean ("Send the member a DM (default: on)"). The default comes from the server's **Member DMs** setting on the dashboard Moderation page (or `/mod-settings set dm-members`).

- `dm:false`: no DM and no Appeal button.
- `dm:true`: the DM states the action, reason and `Case #N`. Ban, kick, timeout and warning DMs include an Appeal button when the dm-appeals setting is on. Ban and kick DMs are sent **before** the action, because the member can no longer be reached afterwards.
- Unban DMs only arrive if the user still shares another server with the bot. Otherwise the DM is recorded as failed and the unban still completes.
- The public confirmation embed has a **DM** field: `Sent`, `Not sent (disabled)` or `Failed (DMs closed)`.

### Output and case numbers

Lists (`/warnings`, `/modlogs`, `/appeals list`) and details (`/case`, `/appeals show`) are blurple embeds:
- One field per case, headed `Case #12 · Warn`, with the reason, the moderator as a mention, and a Discord timestamp.
- A `Total: N` footer.
- Public Previous/Next buttons above 10 entries. Only the invoker or staff can press them.
- An empty state such as “Alex has no warnings.”

Cases are numbered sequentially per server (`Case #12`). Existing cases are backfilled in creation order the first time a server's cases are read. `/case`, `/reason`, `/delwarn` and appeals accept the number (`12`, `#12`) or the old ID. Audit-log reasons, DMs, appeals and the dashboard use the number.

Internally, cases use interaction/message IDs, scoped to each server. A reservation is stored before a Discord mutation. Repeated interaction IDs cannot repeat that mutation. Confirmed outcomes and their log-outbox events are committed together. The underlying SQLite database remains editable by its operator; this is an operational audit history, not tamper-proof forensic storage.

## Automod

Message create and cached message edit events enforce literal blocked phrases, invite URLs, excessive mentions and per-member floods. Bot/webhook messages, the owner, administrators, Manage Server/Moderate Members holders and configured moderators are exempt. Matching messages are deleted and a case is saved. Message content is not retained in cases. Filters do not automatically ban, kick or escalate punishments. Review cases before issuing a separate sanction.

Flood windows are local, ten-second windows and reset on restart. Filters cover messages delivered while the bot is online; uncached partial edit events are skipped. They are application-side moderation, not Discord-native AutoMod rules, and cannot prevent a message from briefly appearing. Ambiguous deletes are not retried. Monitor logs and Discord's native safety controls during raids.

## Appeals

Moderation appeals are separate from age verification: `mod-appeal` records live in the bot's `rose.sqlite`, while verification uses `age_cases` in `age-verification.sqlite`. The queues, reviewer authorization and case IDs are independent. Only in-server and externally received **moderation** appeals share a review queue; neither path enters the verification queue.

There are two appeal paths:

- **Members still in the server** use the `/appeals panel` message: **Appeal a case** (case number + statement) and **Check appeal status**.
- **Banned, kicked or timed-out members** receive a DM *before* the action is applied (Discord does not let a bot open a DM with someone who shares no server). The DM states the server, action, reason and case number and has an **Appeal** button. The button's custom ID carries the server and case; on click and on submit the bot checks that the clicking user is the case's target, the case completed, and no appeal exists for it. The modal only asks for the statement. Buttons are handled statelessly, so they keep working after restarts and after the member has left the server. `dm-appeals:false` in `/mod-settings set` removes the button (the notice is still sent).
- If the DM fails (closed DMs, error 50007, timeout), the sanction still proceeds, the case records `dm: failed`, and the moderator sees: "Could not DM the member. If they contact staff another way, use /appeals record." Staff then enter the appeal with `/appeals record`.

Members who leave on their own get no DM and must use the server's published contact (shown on the panel if `appeal-contact` is set).

Staff use `/appeals list`, `/appeals show appeal:...` and `/appeals review appeal:... decision:accepted|denied reason:...`. Neither the subject nor the original moderator can review the appeal. A decision and its case event are saved together. The member can read the decision privately through the panel. Accepted appeals do not automatically reverse bans/timeouts or erase warnings: staff use the explicit reversal/void command and record a reason.

Appeals never use a public web form or the verification portal. Accepting an appeal never reverses a sanction automatically; the confirmation reminds staff to use `/unban` or `/untimeout`. The member is sent a best-effort DM with the decision.

## Critical Emergency Mode and privacy roles

There was no saved Emergency Mode design in this checkout. This integration is a channel-by-channel, owner/administrator-controlled writing lockdown:

1. `/emergency on channel:#channel reason:...` saves every current role/member overwrite before denying Send Messages, Send Messages in Threads, Create Public/Private Threads and Add Reactions. Repeat for each affected text/announcement channel.
2. `/emergency status` lists saved locks and recovery states. Administrators and the owner still bypass channel permissions. New channels/overwrites created after activation are not automatically locked; review them separately. Voice, invites, joins, webhooks, existing reactions and server-wide verification settings are not changed.
3. `/emergency off channel:#channel reason:...` restores only the saved writing bits. Current visibility and other permission bits are preserved. Concurrent writing changes cause restoration to stop and retain the journal for manual review. Partial operations retain per-overwrite progress across restarts.

`privacy-role` identifies a protected privacy/verification role and must differ from `mod-role`. Moderation never grants/removes roles, never changes View Channel, and never copies private verification evidence into a case. Existing verification reviewer, verified-role and privacy-administration authorization stays separate. A privacy role is not a moderation exemption: members can still receive timeouts and sanctions without losing their privacy role. No identity evidence is requested for appeals.

Do not use a mass role replacement or channel overwrite replacement as an emergency recovery shortcut. Review the saved journal and preserve privacy denies. New role/member overwrites during an incident can weaken a lockdown. Category synchronization may change when channel overwrites are edited; restore category sync manually only after checking the intended privacy policy.

## Uncertain operations and recovery

A network timeout is not proof of failure. A mutation can finish at Discord after the bot stops waiting. Such a case is `uncertain`; a process interrupted during work leaves `pending`. Additional actions for that same target are blocked, including after restart.

The current owner must inspect Discord and its audit log, allow any in-flight request to settle, then use `/mod-reconcile case:... outcome:succeeded|failed reason:...`. This records the observed result; it does not execute the mutation again. Never reconcile speculatively just to remove the block. For a partially applied/restored emergency operation, record the verified case outcome, resolve writing conflicts manually, then run `/emergency off` to finish restoring the saved journal.

Case log sends run every 30 seconds. Queued logs are attempted only when the configured channel is private to @everyone. A claimed log whose send times out becomes `uncertain`; a crash may leave it `sending`. Those sends are never blindly retried. `/mod-settings view` shows delivery issues; inspect the destination and use `/case` as the source of truth. Fix inaccessible channel permissions to allow queued logs to proceed. Confirmation delivery failure never repeats the moderation action.

This is a single-process service. Run one Number One instance per SQLite file; do not share the file among replicas. Retention removes completed cases, their appeals and delivery metadata after the configured age, checked every 30 seconds. Unresolved cases and cases with open appeals are retained for review. Channel log messages and backups need separate deletion/retention policies. Case content consists of staff-supplied reasons, member/staff IDs, timestamps, message IDs and action metadata; avoid adding sensitive evidence to reasons. Operator-assisted data access/deletion must preserve active sanctions and required incident records under the server's published policy.

## Verification before production use

Run `npm ci`, `npm run check`, and `npm test` from this directory. The moderation suite covers the entire new command inventory, authorization denial before option access, scope boundaries, hierarchy, timeouts that never settle, duplicate mutations, purge filtering, appeals, retention, uncertain log sends and privacy-preserving lockdown restoration. Existing transport tests cover stalled confirmations and independent fallbacks.

Use a test server to verify role placement, each bot permission, native timeout expiry, ban/unban, closed/private log channels, member appeal/status buttons and partial-lock restoration before enabling filters in a busy server. Offline tests do not establish live API permissions, operational readiness or deployment. Wispbyte restart is an operator action after GitHub checks pass.
