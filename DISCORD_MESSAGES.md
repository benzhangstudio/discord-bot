# Discord errors are public product copy

Every Discord error must help the person using the bot. It must not reproduce the technical error shown in Wispbyte. This applies to commands, buttons, menus, modals, acknowledgements, follow-ups, moderation failures, staff logs and status views.

Use one or two short sentences: what the user needs to know and their next useful step. Keep input corrections specific. Permission names that a server administrator can change are appropriate; hosting instructions and internal implementation terms are not.

| Situation | Discord | Server log |
| --- | --- | --- |
| Unexpected failure | Something went wrong. Try again later. | Redacted exception, error code and internal reference. |
| Missing permissions | The bot doesn’t have permission to do that here. Ask a server admin to check its permissions. | Discord rejection code and failed operation. |
| Slow lookup | That took too long. Try again. | Which request timed out. |
| Uncertain action | Could not confirm that action. Check the result before trying again. | Outcome, action and case identifier. |
| Automod unavailable | Automod is not enabled for this bot. Contact the bot operator. | Required intent, environment setting and restart instructions. |
| Portal unavailable | The dashboard is unavailable right now. Contact the bot operator. | Invalid hosting configuration. |

`src/public-errors.js` owns the reviewed message catalogue and `publicErrorMessage(error)`. `reportFailure` logs the redacted diagnostic separately and uses only this formatter for Discord. A `UserError` retains diagnostic context in `.message`; its name alone never grants permission to display that message. Unknown messages fail closed to generic copy. Do not automatically forward exception text or an alleged `publicMessage` property from an external service.

Add a reviewed catalogue entry when introducing a validation error. Keep public copy under 160 characters, without hosting details, codes, secrets or technical paths. Preserve useful commands and input examples. The source-coverage regression test checks current validation messages; the unknown-error tests verify that future unmapped failures remain safe.

Saved moderation failures use short public outcome copy, not an exception or full case dump. Explicit case-history screens may show legitimate case IDs and staff notes, but no raw stored backend errors. Settings/status screens use readable labels and summaries rather than JSON or internal delivery states. Keep uncertain outcomes honest; never promise failure merely because confirmation timed out, and never repeat the mutation to send its result.

This requirement is permanent in `AGENTS.md`. Regression tests cover validation, unknown exceptions, forged UserErrors, credentials/URLs/paths, deferred and fallback replies, privacy and stalled delivery. Offline tests do not establish live Discord delivery.

## Completing every reply

Use the shared response helpers for commands, buttons, menus and forms. Known protected moderation targets are rejected before network preflight, avoiding a deferred loading state. Delayed replies that hit a long Discord cooldown retain their exact final content and retry on the independent reply transport after the cooldown. Recovery edits the original deferred reply; it never reruns a command, resends an announcement or reissues a moderation action. Setup-form errors preserve the existing form and private follow-up.

Cooldowns apply to the affected interaction token, except when Discord explicitly reports a global limit. Each request is bounded. Recovery stops on permanent rejection, its attempt limit or before the interaction token expires; final failures are recorded in Wispbyte without secrets. No bot can clear a Discord loading state while Discord refuses all reply requests, but a transient cooldown must not silently discard the result. Do not instruct the user to repeat a completed action because its reply is waiting.

Warnings and local moderation record operations use the signed interaction plus complete guild-role data and send their final initial reply without deferring or waiting on REST preflight. Resolved administrator targets are also rejected before network requests, for all relevant moderation commands. Missing role data fails closed immediately. Actual Discord mutations retain fresh REST authorization and hierarchy checks. This reduces unnecessary loading states and webhook edits; it does not override an active Discord cooldown or clear an old deferred message during that cooldown.

## Voice

Bot copy uses a neutral, concise, functional voice. Avoid product branding in titles, footers and modal headings ("Commands", "Edit message", not "Number One · …"). Default embed color is Discord blurple (`5865F2`); `pink` remains an accepted color name. Verification is one dashboard plugin: its test-only/synthetic disclaimer appears only where verification is used (the `/portal open` message and the verification page), not in general commands or help.

## Moderation notices and appeals

Action confirmations are a one-line result plus an embed titled like `Member banned`, with User, Moderator, Reason and Case fields in blurple. Log-channel posts use the same embed.

Affected members get a plain DM before ban, kick or timeout (after a warning): `You were banned from **Server**.` / `Reason: …` / `Case: …`, plus an **Appeal** button unless `dm-appeals` is off. If the DM fails, the moderator's reply adds: "Could not DM the member. If they contact staff another way, use /appeals record."

The `/appeals panel` message is for members still in the server and says that removed members receive an Appeal button by DM. Review replies never imply a sanction changed: "Appeal X accepted. The sanction was not changed; use /unban or /untimeout if needed."
