# Moderation

Number One uses familiar member actions with required inputs first and optional inputs on the same command. Server settings, command access, automod and reaction-role setup live on the dashboard. Moderation appeals are unavailable; verification remains a separate dashboard feature.

## Commands

| Command | Required inputs | Optional inputs and behavior |
| --- | --- | --- |
| `/warn` | `user`, `reason` | `dm`, images, message links. Records one warning. |
| `/unwarn` | `user`, `warning` | `reason`, images, message links. Permanently deletes the warning and its related database records. |
| `/ban` | `user` | `reason`, `dm`, images, message links. Does not erase past messages. |
| `/unban` | `user` | `reason`, `dm`, images, message links. Does not automatically rejoin the member. |
| `/kick` | `user` | `reason`, `dm`, images, message links. |
| `/timeout` | `user`, `duration` | `reason`, `dm`, images, message links. Examples: `10m`, `1h`, `2d`; maximum 28 days. |
| `/untimeout` | `user` | `reason`, `dm`, images, message links. |
| `/purge` | `count` | `user` filter, `reason`, images, message links. Checks up to 100 recent messages; skips pinned and old messages. |
| `/case` | A `user` or a `number` | `page` for history; `reason` and images add context to the specified number; `outcome` is owner-only. |
| `/lockdown` | None for status | `channel` plus `locked:true` locks; `locked:false` restores saved writing permissions. Optional reason and images. |

### One moderation history

Use `/case user:@Alex` to see all of Alex’s moderation records, including active warnings. Removed warnings are permanently deleted and are not listed. Each page contains 10 records. Use `page:2` for older records; Previous/Next navigation is also available. There is no separate warnings list or removal-button collection.

The short number in `Case #12` identifies that exact record in this server. It is not a Discord user ID or a long internal interaction ID. It never changes when another warning is removed. To remove that warning, use `/unwarn user:@Alex warning:12 reason:Issued by mistake`. The bot verifies both the member and the warning, then deletes its case, stored images/links, notes, reserved-number record and related log/appeal records in one transaction. The case-number counter remains so numbers are never reused. Bans, timeouts and other records cannot be removed with `/unwarn`.

Use `/case number:12` to view details, or `/case number:12 reason:Additional context image:...` to add a note and an optional image. Supplying an image without a note also adds it to that case; there is no separate image command. Adding context requires an explicit case number, so the bot never silently chooses the latest case. If both member and number are supplied, they must match.

Only the current owner can set `outcome:Completed` or `outcome:Not completed`, with a reason, after checking an uncertain action in Discord. This updates the record; it never repeats the action.

### Images and links

`image`, `image2` and `image3` are optional image attachments on actions and case updates. `/unwarn` accepts only the member, warning number and optional confirmation reason because its case is deleted. Discord controls its native attachment input; the bot does not provide a custom clipboard box. PNG, JPEG, GIF and WebP images are supported up to 10 MB each. `message-link` accepts up to five Discord message links from the same server. A case can retain up to 10 attachments and links in total.

Images appear under **Attachments** in confirmations, history and logs, and are never included in member DMs. Existing stored images remain compatible. With the mod log enabled and Attach Files allowed, images are copied to the log channel; otherwise original Discord upload links can expire.

### Member notices

The `dm` option overrides the dashboard’s default member-notice setting. Notices state the action, server and reason. They contain no appeal controls or case number. Ban and kick notices are attempted before removal; failed DMs never block moderation. The public confirmation reports a failed notice separately from the completed action. Moderation appeal commands, panels, forms, DM buttons and dashboard settings are removed. Old controls display an unavailable message and cannot create a new appeal. Historical records are retained.

## Setup and permissions

1. Keep Node 24.12 or newer, `AUTO_UPDATE=1`, and startup file `src/index.js` on Wispbyte. Keep its existing `data/` folder and private environment settings.
2. Place the bot above members it must moderate. Grant only needed permissions: View Channel, Send Messages, Moderate Members, Kick Members, Ban Members, Manage Messages, Read Message History, and Manage Roles for lockdown restoration.
3. Configure the log channel under Dashboard → Moderation → Mod log. View Channel, Send Messages, Embed Links and Attach Files are used. Give View Audit Log if you want to capture bans, unbans, kicks and timeouts done outside Number One.
4. The current server owner grants additional command access under Dashboard → Access. Administrator or Manage Server already grants general command access. Approved users cannot grant access to others or bypass channel permissions.
5. Moderation also checks each action’s relevant native permission or the configured moderator role. Manage Server alone does not confer moderation powers. Configure the moderator/protected roles and retention on the dashboard.
6. Automod is off by default. Message filters require `MODERATION_MESSAGE_CONTENT=1` and Message Content Intent, then dashboard configuration. Normal moderation does not require that intent.

Owner, bot, administrator, configured-moderator and role-hierarchy protections apply. Discord mutations refresh permissions before execution. Local warnings, case history, notes and warning removals use complete signed interaction data without redundant REST preflight. Missing role data fails closed.

## Mod log, persistence and recovery

Mod log starts off per server. Supported events are bans/unbans, kicks, warnings/removals, timeouts/removals, purges, lockdown, case updates and external moderation actions. Each can be toggled on the dashboard. Historical moderation appeal events are not newly delivered. An unconfirmed send is retained for review, not automatically repeated.

Lockdown saves a restoration journal before changing writing permissions. Restoration preserves independently changed visibility settings and refuses conflicting writing changes. Partial operations keep their journal for review.

Use one bot process per SQLite file. Retention keeps pending/uncertain cases and legacy records with an unresolved historical appeal; completed expired cases follow the configured policy. Existing cases, numbers, images, schedules, access grants and reaction roles are preserved. Command changes do not require a database replacement.

Before release, run `npm run check` and `npm test`. Tests cover registered command paths, ordinary-member denial before input access, real discord.js interactions, hierarchy, persistence, 50-warning history, attachment validation, uncertain mutations, stalled requests, fallback replies and recovery. Offline tests do not establish live Discord delivery.

After GitHub checks pass, restart Wispbyte with auto-update enabled. Confirm the deployed commit and successful command verification. Old commands and subcommands are removed on registration; cached copies return guidance. Do not replace production files or upload a development database.

Previously voided or removed cases are automatically deleted on startup, maintenance, or a case-history/dashboard read. They are not moved to an archive. The deletion is server-scoped and rolls back completely on a storage failure. Pending DM and log completions cannot recreate the deleted case. Run `/case user` again to see the updated history; earlier Discord messages are not live database views.
