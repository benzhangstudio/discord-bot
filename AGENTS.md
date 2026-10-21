# Number One release requirements

- Work in this checkout. Do not create replacement project folders or edit synced sources.
- Every command and component must finish with success, an actionable error, or an explicitly uncertain delivery result. Do not leave staff indefinitely waiting on a thinking/loading state.
- Before every push, inspect response paths and test requests that never settle at each network step, including the fallback itself. A rejected-request test alone is insufficient.
- Confirmations must not wait on the same stalled SDK queue as their fallback. Bound both attempts and log delivery failures without tokens or URLs.
- Never retry an announcement or mutation just because its confirmation failed. For uncertain sends, tell staff to inspect the destination before retrying.
- Run the command inventory, transport, permission, persistence, and timeout checks before publishing. Check GitHub CI afterward. Do not claim live Discord verification from offline tests.
- Wispbyte automatically pulls on restart when AUTO_UPDATE=1. After a pushed update, ask the user to restart, not manually replace files or separately pull.

- Do not add unsolicited DM fallbacks. Deliver command results through the original interaction.

- Every slash command requires Administrator, Manage Server, or an explicit user grant made by the current Discord server owner. Grants are server-scoped. Only the current server owner may manage grants through /access; administrators and approved users cannot grant others. Do not infer access from custom staff roles. Deny unauthorized invocations privately before options/data access; autocomplete must return no suggestions. Test every registered subcommand for both allowed permissions and denied users before pushing.

- /help must stay concise: every command, required inputs, and a one-line summary. Detailed help is sent only when an authorized user clicks DM full manual, only to that clicker. Handle blocked/partial/stalled DMs; do not reintroduce unsolicited DM fallbacks.

- Public-facing replies must be actual success or actionable errors, not request-received receipts or developer timeout disclaimers. Prefer one final initial response for fast actions. For longer work, acknowledge before expiry and finish the loading state. Respect Discord 429 Retry-After/retry_after; never immediately try another route to evade a rate limit. Keep completed side effects separate from failed confirmation delivery in diagnostics.

- Normal command results and actionable errors are public by default. Keep unpublished drafts, feed setup/previews, owner-approved access lists, restricted schedules, RSVP acknowledgements, and unauthorized-user denials private. Apply the same visibility before a delayed acknowledgement and to fallback replies. Internal error references belong only in logs, never in Discord replies.
