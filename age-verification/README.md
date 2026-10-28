# Number One Verification: public multi-server Beta

Members and configured reviewers use **https://number-one.wispbyte.app/verify** or their server's shared verification link. Owners and explicitly approved dashboard members can also open Verification from `/dashboard/SERVER_ID/verification`. They need a Discord account, not GitHub, Wispbyte, environment variables or developer access. The bot operator maintains the application credentials once. Every community configures its own roles through the website.

Authorized command users can use `/dashboard` for server settings and a shareable Verification button. This command uses the bot's existing slash-command permissions; opening the link does not grant dashboard or reviewer access. There is no per-community enablement by the bot operator.

The [verification core](CORE.md) documents the access matrix, transaction and concurrency guarantees, dedicated role protections, and remaining production boundary. Deletion requests immediately close a case to review. Owner-approved dashboard access cannot change reviewer roles or open submissions.

## Public workflow

1. Open the server's verification link and sign in with Discord. OAuth requests `identify guilds` to confirm membership; no email is requested. The dashboard server list separately shows owned servers and explicit owner-approved dashboard grants.
2. Open the intended community. Number One must already be installed there and the account must still belong to it. Its owner can install the bot from the dashboard. A newly joined server becomes available after signing out and back in.
3. Only the current server owner selects the reviewer role and a dedicated **Beta test verified** role on the website, acknowledges synthetic-only testing, and opens that server's Beta. The roles must differ and cannot be @everyone or managed integration roles. The verified role must be below Number One and must not grant administrative/moderation permissions. Number One requires Manage Roles.
4. Copy the generated member link, `https://number-one.wispbyte.app/verify?guild=SERVER_ID`, and share it in that community. The server ID is part of the link, not an application-wide environment setting.
5. Members sign in, see that community's status, consent to the test notice, and choose an invented adult, minor or unverified fixture. Each member may have one active case per server, independently of other servers.
6. The server owner and members of its configured reviewer role see only that server's private review queue. Dashboard approval and Discord management permissions alone do not grant reviewer access. A reviewer claims a case for ten minutes, views only its synthetic portrait and full date of birth, then manually approves or denies. Self-review is blocked. Under-18 approval is blocked; denial is always an explicit human decision.
7. Approval assigns the case's saved test role in the correct server. A generic decision DM names the server ID and includes no evidence. Role and DM delivery have separate results; members can always inspect their status in the portal. Nothing is uploaded to Discord.
8. Members export or request deletion of their records for the selected server. Only its current owner sees audit/privacy administration and fulfills deletion. Deleting one server's case does not remove another community's data or end the account's global sign-in session.

A public Beta is not real identity verification. **No real ID input path exists.** Unknown extraction fixtures, file uploads, external portrait URLs and supplied DOB/document fields are rejected. There is no provider, OCR, real document redaction, or age-assurance integration. Use a test role that does not unlock age-restricted content; synthetic approval does not establish a real member's age.

## One-time application connection

See [../WISPBYTE.md](../WISPBYTE.md). The operator keeps the existing bot token/application ID, adds the OAuth client secret privately once, and registers `https://number-one.wispbyte.app/auth/callback` in Discord. The application reuses that callback for all communities. There are **no per-server environment settings**. Any obsolete `AGE_GUILD_ID`, `AGE_REVIEWER_ROLE_ID` or `AGE_VERIFIED_ROLE_ID` values are ignored.

Hosted startup enables Discord sign-in automatically when the private client secret is present. An explicit `AGE_MODE=setup` is a maintenance lock: remove that line or change it to `discord` to permit public sign-in. Missing application credentials keep sign-in unavailable; members are not instructed to configure hosting. GitHub publishes code and checks it; Wispbyte changes only when you manually refresh/restart it. Keep startup at `src/index.js`.

## Local synthetic demo

Node.js 24.12+ is required; no additional dependencies are needed.

```powershell
cd age-verification
Copy-Item .env.example .env
npm start
```

Open http://127.0.0.1:3100/verify. Demo mode is loopback only and must never be proxied or published. Hosted startup rejects it.

1. Enter as **Server owner**, choose Demo community, select the supplied reviewer/test roles, acknowledge the Beta notice, and save with submissions enabled. Repeat for Second demo community to exercise isolation.
2. Sign out, enter as Member, choose Demo community and submit an adult fixture. Submit a separate minor fixture in Second demo community.
3. Sign out and enter as Reviewer. Claim and approve the first server's adult case. In a second browser profile, Second reviewer must be unable to steal the claim. Only portrait, full DOB and a synthetic marker are returned by the evidence endpoint.
4. In the second server, attempt approval on the minor case: it remains pending. Manually deny it instead. The first community's case is unaffected. Demo role/DM results read simulated.
5. As Member request deletion in one server, then fulfill it as Owner. Export from the other community: its case remains. Managers and reviewers cannot access owner-only audits/privacy administration.
6. Choose the unverified fixture after deleting a case: submission fails closed without creating a case. Closed or unconfigured communities block submissions and decisions. Old evidence is blocked after 24 hours.

## Authorization, storage and recovery

Each tenant API URL includes its server ID. Every query for cases, claims, audit, settings and privacy requests includes that same scope. Guessing a different server or case ID cannot grant access. OAuth server names are a sign-in snapshot; bot-side membership, ownership and reviewer roles, plus current-owner dashboard grants, are checked on protected server requests. Administrator and Manage Server alone do not grant dashboard configuration access. Dashboard grants and slash-command grants are separate; grants from a previous owner stop authorizing access after ownership changes. Settings saves and decisions recheck permissions after asynchronous preflight checks. OAuth state is browser-bound, single use, expires in five minutes, and preserves the requested server link. Tokens are transient during sign-in and revocation is attempted afterward; they are not stored in SQLite, cookies or browser storage. Sessions last one hour and restart signs users out. Cookies are HttpOnly, SameSite=Lax and Secure on the hosted site.

The guild-scoped schema uses `age_settings`, `age_cases`, `age_audit` and `age_privacy` in `data/age-verification.sqlite`. Settings and cases survive restarts. Each case snapshots its test role, so changing future settings cannot redirect an old case's grant or deletion to another role. The previous single-server schema is not assigned to any community: legacy evidence fields are cleared; operational legacy records remain offline for operator maintenance. Existing bot databases and slash-command authorization are unchanged.

Evidence disappears from active records at decision or after 24 hours, checked on access and every minute. Audit events and completed request metadata expire after 30 days; case/status records remain until deletion. Evidence is hidden on tab backgrounding, server switch and viewing timeout. This does not prevent an authorized viewer from copying or photographing it. Exports include case/status, privacy metadata and related audit events, without evidence. Deletion removes linked active records in one server, leaving only an anonymous completion event. SQLite journals, disk snapshots and backups need their own retention policy; active-record deletion is not a forensic erasure guarantee.

Each Discord network request, including response-body parsing, has an eight-second deadline. OAuth server pagination has a 30-second overall budget plus bounded revocation. The website uses a 60-second request deadline. There are no automatic mutation retries, fallback DMs or rate-limit bypasses. An uncertain role/DM result remains visible separately from the saved decision. Restart marks interrupted pending deliveries uncertain; a completed decision cannot be repeated.

For an uncertain role delivery, the current server owner can Check Discord role status. This reads membership without repeating a grant. An uncertain DM is never automatically resent. If the role is absent, correct permissions and resolve the test role manually in Discord; the portal has no grant-retry operation. Deletion waits for active/uncertain role delivery to be resolved and removes the case's saved role before erasing records. If Discord removal fails, the request stays open. An already departed member's Unknown Member response means no role remains and permits erasure. People who cannot sign in after leaving a community need an owner-assisted privacy path outside this portal.

Before real-ID use, extraction/redaction and storage need independent security/privacy validation, verified provider capabilities/contracts where applicable, proper notices/contact, retention/backups, access review and incident handling. MFA, an encrypted evidence vault, tamper-resistant audit, distributed sessions and durable delivery workers are deferred. Run one process with its private SQLite database.

## Validation

From the Number One repository root:

```powershell
npm run check
npm test
```

Tests include public onboarding, per-server roles/settings, membership and privilege revocation, cross-server ID tampering, persistence/recovery, birthday boundaries, manual denials, privacy isolation, role snapshots, OAuth state/pagination/revocation, safe role hierarchy and never-settling network/body requests. Offline tests do not establish that live Discord or a provider is connected.

Discord references: [OAuth2](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx), [user/guild discovery](https://github.com/discord/discord-api-docs/blob/main/developers/resources/user.mdx), [guild role operations](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild.mdx).
