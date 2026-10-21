# Number One Age Verification Beta v0.1

Single-server prototype, inside the existing Number One checkout. The existing bot startup also starts the dashboard at `https://number-one.wispbyte.app`, with `/verify` for the member portal and protected reviewer dashboard. Wispbyte supplies HTTPS through its subdomain proxy. See [../WISPBYTE.md](../WISPBYTE.md) for the staged GitHub → Wispbyte rollout. The public portal defaults to locked setup mode; no live Discord/provider verification is claimed. It uses the same Discord application/bot without changing slash commands or connecting another gateway client. The standalone local demo below remains available for development.

## Run the synthetic demo

Requires Node.js 24.12+ (built-in SQLite). No packages to install.

```powershell
cd age-verification
Copy-Item .env.example .env
npm start
```

Open **http://127.0.0.1:3100/verify**. Leave AGE_MODE=demo. Demo binds only to loopback; never expose demo mode through a proxy or tunnel. It lets anyone at the local computer choose a test identity and is not authentication for a hosted service. All role/DM operations are explicitly simulated.

1. Enter as **Member**, choose Synthetic adult, read/check the notice, submit.
2. Sign out, enter as **Reviewer**. Claim & view the case. The evidence response contains only the invented portrait, full DOB and synthetic marker. Approve. The result displays simulated role and DM delivery.
3. For competing claims, open a second browser profile as **Second reviewer**. A case claimed by someone else cannot be viewed or decided until its 10-minute lease expires. The original reviewer can renew by claiming again.
4. Member → request deletion. Owner → fulfill deletion. The member's case, linked audits, requests and portal sessions disappear. Demo role revocation is simulated.
5. Member → submit Synthetic under 18. Reviewer → try Approve (blocked, case stays pending), then **Manually deny**. There is no automatic under-18 denial.
6. Delete the case again, then choose Unverified extraction. Submission is blocked without creating review evidence. Requests with raw-ID fields, image URLs, DOB overrides or multipart uploads are rejected. No file picker exists.
7. Member → request/download an export. Owner → audit/privacy administration. Reviewers cannot use owner administration; non-members cannot use the portal.

Expired evidence is blocked after 24 hours. Ask for deletion before resubmitting. A decision immediately removes DOB and portrait from active case records. The UI clears evidence when hidden or its local viewing timer expires. Reviewers could still copy anything they were authorized to view; this prototype cannot prevent screenshots.

## Configure Discord sandbox integration

**Not live-verified.** The Discord REST adapter is implemented and covered by mocks. No provider credentials, real document processor, OCR, redaction model or identity-assurance service is connected. Discord mode still uses synthetic fixtures only. Approval means a *test workflow decision*, not proof of a member's real age. Use a private test server and a dedicated **Beta test verified** role that grants no access to adult-only content. Do not point this prototype at a production age-gating role.

1. In the intended Discord application, configure OAuth2 redirect URI exactly `https://YOUR_HOST/auth/callback`. The login uses authorization-code OAuth with `identify` only. The bot checks server membership and roles through its own credentials; users must already belong to the one configured guild. No email scope is requested.
2. Install the bot in that test server with the bot scope and **Manage Roles**. Put its highest role above the dedicated test verified role. Do not give Administrator. The verified role must not be managed by an integration or be @everyone. Configure a separate, non-everyone reviewer role; the current server owner also has access. Only the current owner can access privacy/audit administration. Reviewer grants here apply only to this website, not Number One slash-command permissions.
3. For Wispbyte's combined bot/dashboard startup, use the **root `.env`** and the settings in [../WISPBYTE.md](../WISPBYTE.md). For a standalone service only, set these values in `age-verification/.env` or the service environment (never commit secrets):

```dotenv
AGE_MODE=discord
AGE_ORIGIN=https://YOUR_HOST
AGE_PORT=3100
AGE_GUILD_ID=YOUR_TEST_SERVER_ID
AGE_CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
AGE_CLIENT_SECRET=YOUR_OAUTH_CLIENT_SECRET
AGE_BOT_TOKEN=YOUR_BOT_TOKEN
AGE_REVIEWER_ROLE_ID=YOUR_REVIEWER_ROLE_ID
AGE_VERIFIED_ROLE_ID=YOUR_BETA_TEST_VERIFIED_ROLE_ID
AGE_DB=data/age.sqlite
```

4. On Wispbyte, keep startup at `src/index.js`: it starts the dashboard on the assigned public port (16243 by default), bound to 0.0.0.0. The Wispbyte HTTPS proxy must preserve Host and forward `X-Forwarded-Proto: https`. The standalone `npm start` in this subfolder is for local testing or separately managed hosting and binds only to loopback; for that standalone path, supply your own same-host HTTPS proxy. Do not expose local demo mode publicly.
5. Open `/verify` and sign in through Discord. Membership and owner/custom-role authorization are refreshed on every protected request. Removing the reviewer role removes subsequent API access. Restarting the service signs everyone out. Sessions expire after one hour; cookies are HttpOnly, SameSite=Lax and Secure in Discord mode. OAuth state is bound to the initiating browser, expires in five minutes and is single use. Access tokens are held transiently and revocation is attempted after identity exchange.
6. Manually share the portal link in the test server. Do not post IDs, portraits, DOB or evidence links in Discord. Only generic decision messages are sent by DM. DMs can fail if closed by the member; the portal remains the source of status.
7. Exercise adult, under-18, revoked reviewer, non-member, missing Manage Roles, wrong hierarchy and closed-DM cases. Check role assignments in Discord and delivery fields in the portal. Only after these checks may the **Discord sandbox** be described as connected. Real document processing remains unavailable regardless.

Discord references: [OAuth2](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx), [guild role endpoints](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild.mdx), [DM creation](https://github.com/discord/discord-api-docs/blob/main/developers/resources/user.mdx), [role permissions](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx).

## Decisions, failures and recovery

Claims use a conditional SQLite update so two reviewers cannot hold a current claim. Decision changes are synchronous, before network calls. Self-review is blocked. The claim holder must still have current reviewer authorization and unexpired verified evidence. Under-18 approval is blocked using full UTC calendar dates; denial is always manual.

Role assignment and DM delivery have independent statuses. A successful decision cannot be repeated. Each Discord request, including response-body parsing, has an eight-second deadline. There are no automatic mutation retries, DM fallbacks or rate-limit bypasses. Rate limits end the request with an actionable wait message. A failed/timed-out role or DM call is marked **uncertain**, because an HTTP failure cannot reliably prove that a side effect never happened. Inspect Discord before taking further action. The UI's 45-second deadline tells you to refresh rather than resubmit a decision.

For an uncertain role result, the owner can **Check Discord role status**. This reads current membership; it does not resend a grant. If absent, correct permissions and manually grant the dedicated test role in Discord if appropriate, then use the check again while still uncertain. Once recorded as not_delivered, use Discord directly and audit the maintenance externally; v0.1 has no grant-retry endpoint. An uncertain DM is never automatically resent; use the portal result. Interrupted pending deliveries become uncertain on startup.

Deletion is held while role delivery is active/uncertain. Reconcile first. Fulfillment of an approved case removes the configured role before deleting local records; if that removal fails, the privacy request stays open. Fix the Discord issue, inspect current role membership, and fulfill again (role removal is idempotent). Members who leave the server need an owner-assisted privacy path outside this login flow; the owner can still see existing requests. Never treat a blocked deletion as completed.

## Storage and privacy boundaries

SQLite stores Discord user IDs, case UUIDs, decisions, timed claim IDs, delivery states, privacy request metadata and minimal audit events. It stores only server-generated synthetic DOB/portrait fixture references, never real ID bytes. The reviewer queue excludes DOB and portrait; only the claimant's evidence endpoint releases those two ID fields. Audit events exclude document fields, tokens and message content. No raw ID is sent to Discord.

Evidence is removed from active records at decision or after 24 hours, checked on access and once per minute while running. Audit events and completed request metadata expire after 30 days; operational case/status records remain until deletion. Exports include case/status, requests and relevant audit events, without document evidence. Deletion removes all linked records and sessions; a single anonymous completion event remains. This is active-record deletion, not a forensic erasure guarantee: SQLite journals, backups and disk snapshots require a separate retention/erasure policy. Keep `data/` private and do not back it up with production data. Never commit it.

Before any real-ID pilot: independently validate extraction and redaction with fail-closed evidence verification; select and verify actual provider capabilities and contracts if used; replace fixtures with a reviewed processing boundary; define lawful handling, notices/contact, age-policy details, access review, retention/backups and incident response; complete security/privacy validation. The current adapter deliberately has **no real-ID input path or switch to enable one**. Advanced controls such as MFA, encrypted evidence vaults, tamper-resistant audit, distributed sessions, durable delivery workers and multi-server tenancy are deferred. Run one service process with one private SQLite database; this is a prototype, not a hardened production identity system.

## Tests

```powershell
cd age-verification
npm test
```

Tests cover adapter rejection, exact evidence shape, birthday boundary, shared claims, expiry, manual minor denial, persistence, privacy deletion, authentication/authorization, CSRF, OAuth state binding/replay, revoked reviewer access, independent uncertain role/DM results, duplicate-decision prevention, and never-settling network/JSON-body requests. These are offline/local checks, not live Discord or real redaction verification.
