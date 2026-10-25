# Command and dashboard review — 2026-10-25

Reviewed the full registered command surface and its repository integrations. The user-facing standard is familiar action names, clear required inputs, optional details on the same action, and no opaque record selectors. This review follows the latest request: remove the duplicate warnings list, moderation appeals, and reaction-role setup slash commands.

## Result

The baseline at commit 28a5031 had 18 root commands and 53 selectable command/subcommand paths. The revised surface has 16 root commands and 30 paths. Access was already moved to the dashboard in 28a5031. This reduces menu clutter; command count alone does not establish lower Discord server load.

| Command or feature | Final decision | Reason |
| --- | --- | --- |
| `/ban` | Keep user + optional reason, dm, images and message links | Familiar member action; never silently reverse it. |
| `/unban` | Keep user + optional reason, dm and attachments | Explicit reversal; membership is not automatically restored. |
| `/kick` | Keep user + optional reason, dm and attachments | Distinct immediate member action. |
| `/warn` | Keep user and reason + optional dm/images/links | Images belong on the action and remain optional. |
| `/unwarn` | Replace warnings remove with user + short warning number + optional reason/images | No duplicate list or record dropdown; verify the warning belongs to that member. |
| `/timeout` | Keep user/duration + optional reason, dm and attachments | Duration is part of the action. |
| `/untimeout` | Keep user + optional reason, dm and attachments | Explicit reversal remains easy to recognize. |
| `/purge` | Keep count + optional member filter, reason and attachments | One action; pinned/old messages remain excluded. |
| `/case` | Combine history, view, reason, images and outcome into optional inputs | `/case user` is the only moderation history. A number selects one stable record for viewing/editing; no raw interaction ID. |
| `/lockdown` | Combine status/on/off | No inputs shows status; channel + locked boolean performs the explicit change. |
| `/settings` | Combine view/timezone/status | No inputs shows settings; zone and status are optional. |
| `/embed` | Keep create/edit/list/delete/send; move section removal into edit options | Publishing/deleting are intentional actions; section removal is an edit. Saved builder work remains available. |
| `/schedule` | Keep add/list/show/edit/post/cancel; combine configure with edit | Reminder, duration and repetition are optional edit inputs. Do not combine cancel and post with ambiguous flags. |
| `/instagram` | Keep setup/list/preview/pause/resume/remove | Saved source setup is already combined; preview is read-only while remove and delivery controls are explicit actions. No new per-field commands. |
| `/help` | Keep one category menu generated from current definitions | No old warnings, appeal or reaction-role command entries. |
| `/dashboard` | Keep one entry point | Access, moderation settings, automod, verification and reaction-role setup belong here. |
| Access | Dashboard only, current owner only | Existing grants and authorization remain server-scoped. |
| Reaction roles | Dashboard only, with save/resume/copy/publish | Published controls, unique/normal modes, temporary roles and eligibility remain active. Drafts persist without a Discord send. |
| Moderation appeals | Remove all commands, panel/DM controls and dashboard settings | No new moderation appeals; historical stored records are retained. Verification is separate and unchanged. |
| Warnings list | Remove | Case history already contains warnings and their removal history. |

## Integration checks

- Inventory: commands, options, help, autocomplete, cached-command guidance, global/guild registration and plugin gating. Required inputs precede optional ones; recursive schema validation remains active.
- Response paths: initial, deferred, error, permission denial, stalled lookups, stalled confirmation/fallback, rate-limit recovery and visibility. Ordinary Discord messages contain no new internal IDs or “proof” attachment labels.
- Permission checks: ordinary members denied before input access; current-owner grants, native moderation permissions and hierarchy retained. Missing owner metadata does not grant access. History pagination rechecks current staff access and feature state.
- Storage: existing database schema and records retained. Drafts are server-scoped, accept incomplete work, and cannot overwrite another server’s draft. Stable case numbers are not confused with numeric internal IDs. Removed warnings remain in history.
- Side effects: optional images are validated before moderation. A saved-draft publish retains a durable barrier after an uncertain send; retry/restart cannot automatically post the same draft twice. Stalled preflight cannot later publish after expiry.
- Dashboard: no moderation appeal controls, no reaction-role slash command references, explicit Save versus Send to Discord, resume after reload and copy of existing setups. Browser verification uses disposable data and simulated Discord actions.
- Preservation: moderation, automod, lockdown restoration, event/rotation/reminder delivery, embed publishing, Instagram collection, access grants, published reaction-role handling and verification regressions run in the full suite.

## Repository inventory

All tracked files below were included in the command/integration inventory. Runtime support and unchanged verification behavior are covered by their existing regression suites; this is not a claim of live Discord or Wispbyte verification. Generated dependencies, build output, private environment files, runtime databases and temporary logs are excluded. Synced project sources outside this checkout were not edited.

| File | Review area |
| --- | --- |
| `.env.example` | Release, documentation and support |
| `.gitattributes` | Release, documentation and support |
| `.github/workflows/checks.yml` | Release, documentation and support |
| `.gitignore` | Release, documentation and support |
| `.node-version` | Release, documentation and support |
| `AGENTS.md` | Release, documentation and support |
| `DISCORD_MESSAGES.md` | Release, documentation and support |
| `LICENSE` | Release, documentation and support |
| `MODERATION.md` | Release, documentation and support |
| `README.md` | Release, documentation and support |
| `WISPBYTE.md` | Release, documentation and support |
| `age-verification/.env.example` | Dashboard and verification |
| `age-verification/.gitignore` | Dashboard and verification |
| `age-verification/README.md` | Dashboard and verification |
| `age-verification/core.js` | Dashboard and verification |
| `age-verification/discord.js` | Dashboard and verification |
| `age-verification/package.json` | Dashboard and verification |
| `age-verification/public/app.js` | Dashboard and verification |
| `age-verification/public/dashboard.html` | Dashboard and verification |
| `age-verification/public/dashboard.js` | Dashboard and verification |
| `age-verification/public/logo.svg` | Dashboard and verification |
| `age-verification/public/portrait.svg` | Dashboard and verification |
| `age-verification/public/style.css` | Dashboard and verification |
| `age-verification/server.js` | Dashboard and verification |
| `age-verification/test/core.test.js` | Tests and fixtures |
| `package-lock.json` | Release, documentation and support |
| `package.json` | Release, documentation and support |
| `scripts/check.mjs` | Release, documentation and support |
| `scripts/dump-command-text.mjs` | Release, documentation and support |
| `src/access.js` | Command/runtime integration |
| `src/app.js` | Command/runtime integration |
| `src/command-schema.js` | Command/runtime integration |
| `src/commands.js` | Command/runtime integration |
| `src/config.js` | Command/runtime integration |
| `src/dashboard-api.js` | Command/runtime integration |
| `src/dashboard.js` | Command/runtime integration |
| `src/domain.js` | Command/runtime integration |
| `src/error-embed.js` | Command/runtime integration |
| `src/feeds.js` | Command/runtime integration |
| `src/help.js` | Command/runtime integration |
| `src/index.js` | Command/runtime integration |
| `src/instagram.js` | Command/runtime integration |
| `src/interaction-transport.js` | Command/runtime integration |
| `src/mod-format.js` | Command/runtime integration |
| `src/mod-proof.js` | Command/runtime integration |
| `src/moderation-commands.js` | Command/runtime integration |
| `src/moderation-core.js` | Command/runtime integration |
| `src/moderation.js` | Command/runtime integration |
| `src/modlog.js` | Command/runtime integration |
| `src/permissions.js` | Command/runtime integration |
| `src/plugins.js` | Command/runtime integration |
| `src/portal.js` | Command/runtime integration |
| `src/public-errors.js` | Command/runtime integration |
| `src/reaction-role-messages.js` | Command/runtime integration |
| `src/reaction-roles.js` | Command/runtime integration |
| `src/register.js` | Command/runtime integration |
| `src/registration.js` | Command/runtime integration |
| `src/reply-recovery.js` | Command/runtime integration |
| `src/responses.js` | Command/runtime integration |
| `src/store.js` | Command/runtime integration |
| `src/suggestions.js` | Command/runtime integration |
| `src/user-error.js` | Command/runtime integration |
| `src/weekly-feeds.js` | Command/runtime integration |
| `src/worker.js` | Command/runtime integration |
| `tests/command-schema.test.js` | Tests and fixtures |
| `tests/config.test.js` | Tests and fixtures |
| `tests/core.test.js` | Tests and fixtures |
| `tests/dashboard-api.test.js` | Tests and fixtures |
| `tests/dashboard.test.js` | Tests and fixtures |
| `tests/error-embed.test.js` | Tests and fixtures |
| `tests/help-transport.test.js` | Tests and fixtures |
| `tests/help.test.js` | Tests and fixtures |
| `tests/immediate-moderation.test.js` | Tests and fixtures |
| `tests/instagram.test.js` | Tests and fixtures |
| `tests/interaction-transport.test.js` | Tests and fixtures |
| `tests/interactions.test.js` | Tests and fixtures |
| `tests/mod-format.test.js` | Tests and fixtures |
| `tests/moderation.test.js` | Tests and fixtures |
| `tests/modlog.test.js` | Tests and fixtures |
| `tests/portal.test.js` | Tests and fixtures |
| `tests/public-errors.test.js` | Tests and fixtures |
| `tests/reaction-roles.test.js` | Tests and fixtures |
| `tests/registration.test.js` | Tests and fixtures |
| `tests/reply-recovery.test.js` | Tests and fixtures |
| `tests/responses.test.js` | Tests and fixtures |
| `tests/snapshots/case.json` | Tests and fixtures |
| `tests/snapshots/modlogs.json` | Tests and fixtures |
| `tests/text-of.js` | Tests and fixtures |
| `tests/usability.test.js` | Tests and fixtures |
| `tests/weekly-feeds.test.js` | Tests and fixtures |
| `tests/worker.test.js` | Tests and fixtures |

## Files changed in this release

- `age-verification/public/app.js`
- `AGENTS.md`
- `COMMAND_REVIEW.md`
- `DISCORD_MESSAGES.md`
- `MODERATION.md`
- `README.md`
- `age-verification/public/dashboard.js`
- `src/app.js`
- `src/commands.js`
- `src/dashboard-api.js`
- `src/help.js`
- `src/instagram.js`
- `src/mod-format.js`
- `src/mod-proof.js`
- `src/moderation-commands.js`
- `src/moderation-core.js`
- `src/moderation.js`
- `src/modlog.js`
- `src/plugins.js`
- `src/public-errors.js`
- `src/reaction-role-commands.js` (removed)
- `src/reaction-role-messages.js`
- `src/reaction-roles.js`
- `src/suggestions.js`
- `tests/command-schema.test.js`
- `tests/help-transport.test.js`
- `tests/immediate-moderation.test.js`
- `tests/interactions.test.js`
- `tests/mod-format.test.js`
- `tests/moderation.test.js`
- `tests/modlog.test.js`
- `tests/reaction-roles.test.js`
- `tests/registration.test.js`
- `tests/snapshots/appeals-list.json` (removed)
- `tests/snapshots/appeals-show.json` (removed)
- `tests/snapshots/case.json`
- `tests/snapshots/warnings-empty.json` (removed)
- `tests/snapshots/warnings.json` (removed)

## Reaction-role follow-up

Save persists new and edited configurations only in the portal. Send to Discord is a separate explicit action. Normal mode toggles an already-held role off when removal is enabled, and unreacting also removes it. Fresh member fetches and per-member event ordering prevent stale caches and fast add/remove races from leaving a role stuck. Sticky/add-only behavior remains available only when removal is explicitly unchecked.

## Release validation

493 tests passed on local Node 25, plus all syntax checks. Browser checks with disposable data verified saving, reloading/resuming, sending, copying, and saving/sending edits without reposting. Reaction tests cover stale role caches, already-held roles, native unreacts and rapid add/remove ordering. Live Discord and Wispbyte verification requires the production restart.

## Commit-driven development activity

A separate follow-up adds a Watching activity labelled BETA • Being updated by the developer. Main-branch commit notifications trigger a verified GitHub check; duplicate notifications do not reset the one-hour deadline. Requests are bounded, coalesced and honor Retry-After. A periodic fallback and an independent expiry timer keep the status accurate when notifications or GitHub fail. Clearing activity leaves the bot online. The existing dashboard server exposes only a body-free public refresh trigger, without accepting caller-controlled presence or commit values.

Additional files: `src/development-presence.js`, `src/index.js`, `src/dashboard.js`, `age-verification/server.js`, `.github/workflows/development-status.yml`, `tests/development-presence.test.js`, `README.md`, `WISPBYTE.md` and this review. Verification functionality is unchanged.
