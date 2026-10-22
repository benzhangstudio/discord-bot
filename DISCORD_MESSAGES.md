# Discord errors are public product copy

Every Discord error must help the person using the bot. It must not reproduce the technical error shown in Wispbyte. This applies to commands, buttons, menus, modals, acknowledgements, follow-ups, moderation failures, staff logs and status views.

Use one or two short sentences: what the user needs to know and their next useful step. Keep input corrections specific. Permission names that a server administrator can change are appropriate; hosting instructions and internal implementation terms are not.

| Situation | Discord | Server log |
| --- | --- | --- |
| Unexpected failure | Something went wrong. Please try again later. | Redacted exception, error code and internal reference. |
| Missing permissions | I don’t have permission to do that here. Ask a server admin to check my permissions. | Discord rejection code and failed operation. |
| Slow lookup | That took too long. Please try again. | Which request timed out. |
| Uncertain action | I couldn’t confirm that action. Check the result before trying again. | Outcome, action and case identifier. |
| Automod unavailable | Automod isn’t available yet. Please contact bot support. | Required intent, environment setting and restart instructions. |
| Portal unavailable | The portal is unavailable right now. Please contact bot support. | Invalid hosting configuration. |

`src/public-errors.js` owns the reviewed message catalogue and `publicErrorMessage(error)`. `reportFailure` logs the redacted diagnostic separately and uses only this formatter for Discord. A `UserError` retains diagnostic context in `.message`; its name alone never grants permission to display that message. Unknown messages fail closed to generic copy. Do not automatically forward exception text or an alleged `publicMessage` property from an external service.

Add a reviewed catalogue entry when introducing a validation error. Keep public copy under 160 characters, without hosting details, codes, secrets or technical paths. Preserve useful commands and input examples. The source-coverage regression test checks current validation messages; the unknown-error tests verify that future unmapped failures remain safe.

Saved moderation failures use short public outcome copy, not an exception or full case dump. Explicit case-history screens may show legitimate case IDs and staff notes, but no raw stored backend errors. Settings/status screens use readable labels and summaries rather than JSON or internal delivery states. Keep uncertain outcomes honest; never promise failure merely because confirmation timed out, and never repeat the mutation to send its result.

This requirement is permanent in `AGENTS.md`. Regression tests cover validation, unknown exceptions, forged UserErrors, credentials/URLs/paths, deferred and fallback replies, privacy and stalled delivery. Offline tests do not establish live Discord delivery.
