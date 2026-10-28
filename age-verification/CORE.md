# Verification core and release boundary

The HTTP routes use `VerificationWorkflow` for claims, evidence access, decisions,
Discord delivery, reconciliation and deletion. Storage remains in the existing
guild-scoped SQLite database; this update does not replace live data or change
the Wispbyte startup file.

## Access

| Account | Member status/export/deletion request | Review | General dashboard | Verification roles and opening | Privacy administration |
| --- | --- | --- | --- | --- | --- |
| Current server owner | Own records | Yes, except own case | Yes | Yes | Yes |
| Configured reviewer | Own records | Yes, except own case | Only with separate owner approval | No | No |
| Owner-approved dashboard member | Own records | Only with configured reviewer role | Yes | No | No |
| Administrator / Manage Server | Own records | Only with configured reviewer role | Only with separate owner approval | No | No |
| Ordinary member | Own records | No | No | No | No |
| Departed member / nonmember | No authenticated server access | No | No | No | No |

The current owner is checked from Discord. Command grants, dashboard grants and
verification reviewer roles are independent. Losing membership or privileges
blocks the next protected request. Verification security settings require the
current owner, including a fresh check after role validation. General dashboard
approval cannot be used to select a role the delegate already holds as a reviewer
credential.

## State and delivery guarantees

- Submissions, claims, settings, decisions and delivery state changes commit with
  their audit record in one transaction. Decisions remove evidence atomically.
- Claims are exclusive, last ten minutes, and cannot authorize self-review.
- One case mutation runs at a time, including asynchronous authorization,
  delivery, reconciliation and privacy deletion.
- Approval rechecks the saved role, recipient membership, reviewer authorization,
  current settings revision, claim, evidence expiry and deletion requests.
- A deletion request blocks further claims, evidence access and decisions.
- Role and decision-message delivery have separate results. Each send is marked
  uncertain before it starts. No timeout or failed confirmation repeats a grant,
  decision or notification. Restart preserves uncertainty for interrupted work.
- Only an owner can reconcile uncertain role delivery. Unknown Member means no
  role remains. Reconciliation reads Discord and never retries a grant.
- Deletion waits for role delivery to be resolved, removes the saved role and
  rechecks ownership before erasing records. A failed/uncertain removal preserves
  the request and records.
- All network stages have deadlines. A late response cannot save a decision after
  its request has timed out.

Verification reviewer and verified roles must be dedicated roles. Reaction-role
setup and gateway delivery read the same live policy, including already published
messages. A previously granted verification role cannot become the reviewer role.
Servers with conflicting legacy reaction-role setups must choose separate roles.

## Production age verification is still unavailable

The existing submission adapter accepts invented fixtures only. The context API
reports `capabilities.realAgeVerification: false`. Discord sign-in establishes
account identity and server membership; it does not establish age. There is no
production provider or document-processing adapter yet.

Do not remove the Beta notice, accept real identity documents, use an age-gating
role, or describe this release as real age verification. The next core milestone
requires the chosen real verification method, its evidence/result contract and
the necessary private hosted connection. Only after that connection works end to
end should configuration options and a production release be enabled.

Validation runs on GitHub Actions and Wispbyte only. CI covers concurrency,
authorization loss, policy changes, audit rollback, deletion isolation, role
protection and network requests that never settle. Live OAuth, Discord role
delivery and a real verification service need hosted acceptance checks.
