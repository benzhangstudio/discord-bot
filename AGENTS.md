# Number One release requirements

## Every Discord error: permanent public-bot writing rule

- EVERY Discord error must be brief, friendly, and actionable for the invoking user, usually one or two sentences. Number One serves other communities; users are not the Wispbyte operator.
- Never copy raw exceptions or server/Wispbyte output to Discord, even in staff-only replies. Stack traces, SDK/HTTP codes, file paths, environment variables, hosting/restart instructions, internal references, queues and diagnostics belong only in redacted server logs.
- Use the reviewed public-error catalogue through `publicErrorMessage`. Unknown errors, including unknown `UserError` messages, must use a safe generic reply. An exception's diagnostic message is not its public message.
- Apply this to EVERY command, component, modal, acknowledgement, deferred reply, fallback, moderation failure, staff log and status screen. Do not fix only the particular error the user reports. Never recommend blindly retrying an uncertain action.
- Every Discord error is a clean neutral embed built by `errorPayload` in `src/error-embed.js` (grey `0x4F545C`, concise title plus the catalogue message as description, optional fields such as Case). Never send errors as plain content. Server-channel errors stay public; direct-message replies are private by nature.
- Run the public-error catalogue and leakage regression tests before every push. See `DISCORD_MESSAGES.md` for the examples and implementation contract.

- Work in this checkout. Do not create replacement project folders or edit synced sources.
- Every command and component must finish with success, an actionable error, or an explicitly uncertain delivery result. Do not leave staff indefinitely waiting on a thinking/loading state.
- Before every push, inspect response paths and test requests that never settle at each network step, including the fallback itself. A rejected-request test alone is insufficient.
- Confirmations must not wait on the same stalled SDK queue as their fallback. Bound both attempts and log delivery failures without tokens or URLs.
- Never retry an announcement or mutation just because its confirmation failed. For uncertain sends, tell staff to inspect the destination before retrying.
- Apply reply completion/recovery to every feature through the shared response helpers. Never discard an already prepared reply because a Discord cooldown exceeds one network attempt. Queue only that reply on the independent transport, respect Retry-After and actual global limits, and bound recovery before the interaction expires. Reject known invalid targets before network work so common errors never open a loading state. Do not promise delivery while Discord is unreachable; log final delivery failures without rerunning actions.
- Local-only operations such as warnings, case history and staff notes must finish through one initial reply using the signed interaction and complete guild-role data. Do not perform redundant Discord REST preflight or defer these local operations. Missing role data must fail closed with a concise initial error. Discord mutations must retain their fresh authorization and hierarchy checks. Verify both paths with actual discord.js interaction objects, not only plain mocks.
- Run the command inventory, transport, permission, persistence, and timeout checks before publishing. Check GitHub CI afterward. Do not claim live Discord verification from offline tests.
- Wispbyte automatically pulls on restart when AUTO_UPDATE=1. After a pushed update, ask the user to restart, not manually replace files or separately pull.

- Do not add unsolicited DM fallbacks. Deliver command results through the original interaction.

- Every slash command requires Administrator, Manage Server, or an explicit user grant made by the current Discord server owner. Grants are server-scoped. Only the current server owner may manage grants through dashboard Access; administrators and approved users cannot grant others. Do not infer access from custom staff roles. Deny unauthorized invocations (with a public reply) before options/data access; autocomplete must return no suggestions. Test every registered subcommand for both allowed permissions and denied users before pushing.

- /help must stay concise: category menu, commands, required inputs, and one-line summaries. Do not offer or send a DM manual; the feature was removed at the user’s request.

- Public-facing replies must be actual success or actionable errors, not request-received receipts or developer timeout disclaimers. Prefer one final initial response for fast actions. For longer work, acknowledge before expiry and finish the loading state. Respect Discord 429 Retry-After/retry_after; never immediately try another route to evade a rate limit. Keep completed side effects separate from failed confirmation delivery in diagnostics.

- Every reply in a server channel is public: command confirmations, results, lists, previews, drafts, access lists, permission denials, disabled-plugin notices and errors. Never set the ephemeral flag for guild interactions (`respond` strips it as a safeguard). Making replies public must never drop a reply: every command still confirms and every failure still gets a Discord error. Direct messages are private by nature, and modals are Discord UI. Because errors are public, they must never contain diagnostics, stack traces or internal references; those belong only in logs. Verification cases and evidence are managed only on the dashboard, never in Discord.
- Reaction-role gateway handlers never post in channels. Member-side failures are logged (status code only) and the member’s reaction is removed. Setup paths validate Manage Roles, channel permissions and role hierarchy (bot and invoker) before changing anything.

## Command design

- Design from a moderator’s point of view: familiar names, clear required inputs, and optional inputs on the same action. No opaque interaction IDs or case dropdowns for routine moderation. Use short, stable case numbers only when choosing a specific history record.
- `/case user` is the single moderation history. Do not recreate `/warnings` or per-warning removal buttons. `/unwarn user warning` removes one warning by its short history number.
- Images are optional attachment inputs named `image`, never `proof`; retain existing stored attachment data.
- Moderation appeals are removed, including commands, panels, DM controls and dashboard settings. Keep verification separate.
- Reaction-role setup and access management are dashboard-only. Preserve published reaction-role behavior, saved drafts and configuration copying.

- Removing a warning permanently deletes its case and related database records. Do not archive it or retain a Removed entry in history/dashboard. Clean up legacy voided/removed cases and preserve only the case-number counter; late background work must never recreate deleted records.
