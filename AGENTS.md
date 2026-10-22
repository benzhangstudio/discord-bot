# Number One release requirements

## Every Discord error: permanent public-bot writing rule

- EVERY Discord error must be brief, friendly, and actionable for the invoking user, usually one or two sentences. Number One serves other communities; users are not the Wispbyte operator.
- Never copy raw exceptions or server/Wispbyte output to Discord, even in staff-only replies. Stack traces, SDK/HTTP codes, file paths, environment variables, hosting/restart instructions, internal references, queues and diagnostics belong only in redacted server logs.
- Use the reviewed public-error catalogue through `publicErrorMessage`. Unknown errors, including unknown `UserError` messages, must use a safe generic reply. An exception's diagnostic message is not its public message.
- Apply this to EVERY command, component, modal, acknowledgement, deferred reply, fallback, moderation failure, staff log and status screen. Do not fix only the particular error the user reports. Never recommend blindly retrying an uncertain action.
- Run the public-error catalogue and leakage regression tests before every push. See `DISCORD_MESSAGES.md` for the examples and implementation contract.

- Work in this checkout. Do not create replacement project folders or edit synced sources.
- Every command and component must finish with success, an actionable error, or an explicitly uncertain delivery result. Do not leave staff indefinitely waiting on a thinking/loading state.
- Before every push, inspect response paths and test requests that never settle at each network step, including the fallback itself. A rejected-request test alone is insufficient.
- Confirmations must not wait on the same stalled SDK queue as their fallback. Bound both attempts and log delivery failures without tokens or URLs.
- Never retry an announcement or mutation just because its confirmation failed. For uncertain sends, tell staff to inspect the destination before retrying.
- Run the command inventory, transport, permission, persistence, and timeout checks before publishing. Check GitHub CI afterward. Do not claim live Discord verification from offline tests.
- Wispbyte automatically pulls on restart when AUTO_UPDATE=1. After a pushed update, ask the user to restart, not manually replace files or separately pull.

- Do not add unsolicited DM fallbacks. Deliver command results through the original interaction.

- Every slash command requires Administrator, Manage Server, or an explicit user grant made by the current Discord server owner. Grants are server-scoped. Only the current server owner may manage grants through /access; administrators and approved users cannot grant others. Do not infer access from custom staff roles. Deny unauthorized invocations privately before options/data access; autocomplete must return no suggestions. Test every registered subcommand for both allowed permissions and denied users before pushing.

- /help must stay concise: category menu, commands, required inputs, and one-line summaries. Do not offer or send a DM manual; the feature was removed at the user’s request.

- Public-facing replies must be actual success or actionable errors, not request-received receipts or developer timeout disclaimers. Prefer one final initial response for fast actions. For longer work, acknowledge before expiry and finish the loading state. Respect Discord 429 Retry-After/retry_after; never immediately try another route to evade a rate limit. Keep completed side effects separate from failed confirmation delivery in diagnostics.

- Normal command results and actionable errors are public by default. Keep unpublished drafts, feed setup/previews, owner-approved access lists, restricted schedules, RSVP acknowledgements, and unauthorized-user denials private. Apply the same visibility before a delayed acknowledgement and to fallback replies. Internal error references belong only in logs, never in Discord replies.
