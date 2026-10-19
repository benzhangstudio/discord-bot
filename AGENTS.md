# Number One release requirements

- Work in this checkout. Do not create replacement project folders or edit synced sources.
- Every command and component must finish with success, an actionable error, or an explicitly uncertain delivery result. Do not leave staff indefinitely waiting on a thinking/loading state.
- Before every push, inspect response paths and test requests that never settle at each network step, including the fallback itself. A rejected-request test alone is insufficient.
- Confirmations must not wait on the same stalled SDK queue as their fallback. Bound both attempts and log delivery failures without tokens or URLs.
- Never retry an announcement or mutation just because its confirmation failed. For uncertain sends, tell staff to inspect the destination before retrying.
- Run the command inventory, transport, permission, persistence, and timeout checks before publishing. Check GitHub CI afterward. Do not claim live Discord verification from offline tests.
- Wispbyte automatically pulls on restart when AUTO_UPDATE=1. After a pushed update, ask the user to restart, not manually replace files or separately pull.
