# Whole-bot access review

Scope: the complete Number One repository, including the existing checkout's
relevant source changes, command definitions and handlers, all components/forms,
dashboard APIs and browser controls, verification, background workers, storage,
startup/registration, response delivery, tests, documentation and deployment.
The baseline inventory contains 102 GitHub files and 45 source/script/browser
JavaScript files. New policy/regression files extend that inventory.

Excluded from source review: installed dependencies, generated/vendor assets,
build output, credentials, runtime databases, logs and the local write-probe file.
No synced project source was edited. No local bot, dashboard, tests or commits
were run/created. User clarification of the access model was applied throughout
this same review; it did not replace the review with a member-only audit.

## Coverage and findings

| Area | Review coverage | Result |
| --- | --- | --- |
| Command inventory/schema/registration | All commands, subcommands, option paths, native default permissions, retired entries, global/guild sync, autocomplete | Replaced universal management gate with action-specific native permissions; ordinary members cannot invoke or discover enabled command defaults |
| Gateway dispatch/components | Buttons, help menus, embed pickers/forms, Instagram drafts/forms, event forms, RSVP and moderation pagination | Added one authorization gate before input/data access; public controls cannot bypass it; legacy bot grants are inert |
| Moderation | All sanctions, warnings/removal, case history/notes, reconciliation, purge, hierarchy, lockdown, audit capture and automod | Requires the action's native permission; custom moderator roles no longer grant authority or blanket immunity; retains signed-data local paths and fresh mutation checks |
| Dashboard/general content | Overview, settings, plugin switches, messages, schedules, feeds, mod log, access page and reaction-role drafts/publishing | Native manager discovery, fresh checks for every write, no ordinary-member grants, access page is read-only, hidden-channel records are filtered |
| Verification | OAuth/configuration, membership/reviewer checks, submissions, claims, evidence, decisions, role/DM delivery, reconciliation, export/deletion and audit retention | Members only access own portal; reviewer scope is separate; native administrators manage security/privacy; rewards cannot confer command privileges through role bits or channel overrides; personal deletion cannot erase decisions on others |
| Role gateway/expiry | Published and new reaction-role setups, normal/unique/sticky modes, hierarchy, configured verification roles, temporary expiry and failure paths | Ordinary members cannot use role controls; role setup rechecks access before Discord changes; current and snapshotted verification roles stay protected |
| Scheduled/background work | Reminders, rotations, repeats, feed collection/batches, delivery claims, pause/remove races and disabled modules | Module switches now stop background collection/delivery and pending preflight; bounded network stages retain duplicate-send barriers |
| Storage and network helpers | Guild-scoped records/SQLite transactions, delivery journal, feeds/DNS pinning/size/redirect restrictions, proof, errors, transport/recovery and development presence | Tenant scoping and safe error/delivery boundaries retained; new authorization and audit regressions cover identified gaps |
| Startup/deployment/configuration | Entry points, environment loader/examples, package/lock files, scripts, GitHub workflows and hosted configuration | Existing startup and data paths retained; GitHub CI remains the validation location; Wispbyte refresh remains the user's action |
| Tests/assets/documentation | Test inventory and fixtures, client navigation races, schema/transport/permission/persistence/timeout coverage, static page/styles/SVGs, operational/access docs | Replaced superseded grant assumptions, added native-role/member/component/hidden-channel/worker/audit coverage, linked the current policy |

The reviewed response paths include success, validation denial, revoked rights,
stale controls, self-review, cross-server and guessed record IDs, expired claims,
pending deletions, stalled requests, uncertain delivery, rate limits, fallback
and recovery. Existing retry controls never repeat a completed moderation action
or an uncertain message send merely because confirmation failed.

## Release verification and limits

GitHub Actions runs syntax checks and the complete test suite on Node 24, 25 and
26. Release readiness requires all three jobs to pass; the final chat response
links the exact successful release run. This is source/CI review and does not
claim live Discord delivery, OAuth acceptance, Wispbyte deployment, server-role
configuration, or provider age-verification testing. The user refreshes/restarts
Wispbyte after the checked commit is available on main.

The production age-assurance provider/document-processing core is still absent.
Synthetic fixtures remain explicitly marked Beta. [ACCESS_POLICY.md](ACCESS_POLICY.md)
is the current authority for user types; older review notes describe historical
behavior where they conflict with this policy.
