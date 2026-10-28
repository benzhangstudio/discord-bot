# Number One access policy

This policy supersedes earlier custom bot-grant and staff-role access rules.
Discord server permissions are the authority; the website never accepts a
permission, user ID or role claim supplied by the browser as authorization.

| User | Discord commands | Dashboard | Verification |
| --- | --- | --- | --- |
| Current owner | All, with target and bot safety checks | Administration | Own submission, review except self-review, security/privacy administration |
| Administrator | All, with hierarchy and bot safety checks | Administration | Own submission and security/privacy administration; evidence review requires the reviewer role |
| Manage Server | Routine bot management; moderation requires the action's additional permission | Routine configuration and content; channel visibility still applies | Own submission; no security/privacy administration or evidence review unless separately authorized |
| Moderator | Only commands matching native moderation permissions | Requires Manage Server separately | Own submission; review requires the configured reviewer role |
| Configured verification reviewer | No extra command permissions | No extra dashboard permissions | Scoped case review; cannot review self |
| Ordinary member | None, including help, autocomplete, RSVP, menus, forms and reaction-role controls | None | Own submission, status, export and deletion request only |
| Nonmember / departed user | No server actions | No server access | No authenticated server access |

Ban/unban require Ban Members; kick requires Kick Members; warn, unwarn, timeout,
untimeout and case history require Moderate Members; purge requires Manage
Messages. Lockdown status requires Manage Channels and changing lockdown requires
owner/Administrator. Routine message, schedule, feed and settings commands require
Manage Server. Discord's default command permissions hide these commands from
ordinary users; runtime checks remain authoritative if Discord overrides or an
old cached command expose an entry point.

Legacy per-user command grants, dashboard grants and custom staff roles cannot
authorize any request. Existing records are retained inertly rather than deleted
on deployment. Access displays the native policy without listing member grants.
Legacy grant-changing requests keep their owner gate and are rejected as retired.
Change effective access in Discord Server Settings → Roles.

Dashboard writes recheck current permissions; slow content and moderation
operations recheck before mutations. Channel visibility is enforced for saved
schedules, sources and role messages, including guessed record IDs. Manage Server
alone does not expose moderation case evidence. Reaction-role configuration also
requires Manage Roles, observes hierarchy/channel permissions, and cannot offer
verification reviewer or reward roles. Published role controls reject ordinary
members. Disabling a module stops its background work and pending preflight.

Verification security settings and privacy administration require owner or
Administrator. Evidence review remains separate: current owner or the configured
reviewer role, with an exclusive claim, no self-review and no pending deletion.
Reward roles cannot contain administrative/moderation permissions, including
channel overrides, or be recycled into reviewer credentials. Personal deletion
cannot erase a reviewer's decisions on other members' cases; those audit records
keep their normal retention.

Verification still uses invented fixtures only. No live age-verification provider
or real-document pipeline is connected. This access release does not certify a
member's age or remove the Beta boundary.

Deployment: publish code through the connected GitHub account, wait for GitHub
Actions, then the user refreshes/restarts Wispbyte with its existing auto-update.
Do not sign into Wispbyte, operate hosting controls, run a local bot, create local
commits, or run local tests as part of this workflow.

Primary reference: [Discord permissions](https://docs.discord.com/developers/topics/permissions)
and [application command permissions](https://docs.discord.com/developers/interactions/application-commands#permissions).
