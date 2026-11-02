import { useCallback, useEffect, useState } from "react";
import {
  type CaseAction,
  type CaseView,
  type EscalationStep,
  MAX_ESCALATION_STEPS,
  MAX_REASON,
  type ModerationResponse,
  type ModerationSettings,
  actionInfo,
  caseActions,
  durationChoices,
  formatDuration,
} from "../../../src/shared/moderation";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const BAN_DELETE_CHOICES = [
  { days: 0, label: "Don't delete any" },
  { days: 1, label: "Previous 24 hours" },
  { days: 3, label: "Previous 3 days" },
  { days: 7, label: "Previous 7 days" },
];

const EXPIRY_CHOICES = [
  { days: 0, label: "Never" },
  { days: 7, label: "After 1 week" },
  { days: 30, label: "After 30 days" },
  { days: 90, label: "After 90 days" },
  { days: 180, label: "After 6 months" },
  { days: 365, label: "After 1 year" },
];

const COMMANDS: [string, string][] = [
  ["/warn", "Warn a member. Counts towards automatic steps."],
  ["/timeout", "Mute someone for 1 minute to 28 days."],
  ["/untimeout", "End a timeout early."],
  ["/kick", "Remove someone. They can rejoin with an invite."],
  ["/ban", "Ban for good or for a while (e.g. 7d). Works on people who left."],
  ["/unban", "Lift a ban. Suggests banned users as you type."],
  ["/purge", "Bulk-delete up to 100 recent messages, optionally from one person."],
  ["/case", "History, view, note, reason and delete."],
];

/** Dashboard section for Moderation: settings on top, then every case. */
export function ModerationPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<ModerationResponse | null>(null);
  const [draft, setDraft] = useState<ModerationSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: ModerationResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.moderation(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading moderation…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: ModerationSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveModeration(guild.id, draft));
      setNotice("Saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const { status } = data;
  const usedCounts = new Set(draft.escalation.map((s) => s.warnings));
  const nextCount = () => {
    let n = 1;
    while (usedCounts.has(n)) n++;
    return n;
  };

  return (
    <div className="panel moderation">
      <div className="stats mod-stats">
        <div><strong>{status.totalCases}</strong><span className="muted small">cases in total</span></div>
        <div><strong>{status.casesLast7Days}</strong><span className="muted small">this week</span></div>
        <div><strong>{status.warningsLast30Days}</strong><span className="muted small">warnings in 30 days</span></div>
        <div><strong>{status.activeTempBans}</strong><span className="muted small">temporary bans running</span></div>
      </div>

      {status.problems.length > 0 && (
        <div className="notice warning-box">
          <strong>Needs attention</strong>
          {status.problems.map((p) => <span key={p} className="small">⚠️ {p}</span>)}
        </div>
      )}
      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button className="link small" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      <div className="mod-grid">
        <section className="sub">
          <div className="sub-head"><strong>Mod log</strong><small className="muted">Every case is posted here, and updated when its reason changes or it's deleted.</small></div>
          <ChannelSelect guild={guild} value={draft.logChannelId} emptyLabel="No mod log" onChange={(v) => set((d) => { d.logChannelId = v; })} />
          <div className="spaced-top">
            <Toggle
              label="Record actions taken directly in Discord"
              hint="Bans, kicks and timeouts done from Discord's own menus become cases too. Needs View Audit Log."
              checked={draft.trackExternal}
              onChange={(v) => set((d) => { d.trackExternal = v; })}
            />
            <Toggle
              label="Always require a reason"
              hint="Moderators can't act without saying why."
              checked={draft.requireReason}
              onChange={(v) => set((d) => { d.requireReason = v; })}
            />
          </div>
        </section>

        <section className="sub">
          <Toggle
            label="Message members"
            hint="DM people when they're warned, timed out, kicked or banned, with the reason."
            checked={draft.dmMembers}
            onChange={(v) => set((d) => { d.dmMembers = v; })}
          />
          {draft.dmMembers && (
            <div className="sub-body">
              <label className="check">
                <input type="checkbox" checked={draft.dmShowModerator} onChange={(e) => set((d) => { d.dmShowModerator = e.target.checked; })} />
                <span><strong>Say who took the action</strong><small className="muted">Off keeps moderators anonymous to the member.</small></span>
              </label>
              <label className="field">
                <span>Extra text for bans</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. You can appeal at https://forms.example.com/appeal"
                  value={draft.appealMessage}
                  onChange={(e) => set((d) => { d.appealMessage = e.target.value; })}
                />
              </label>
            </div>
          )}
        </section>
      </div>

      <section className="sub">
        <div className="sub-head">
          <strong>Warnings</strong>
          <small className="muted">Take a step automatically when someone collects warnings. Each step fires once, when their warning count reaches that number.</small>
        </div>
        <div className="mod-row">
          <label className="field">
            <span>Warnings stop counting</span>
            <select value={draft.warnExpiryDays} onChange={(e) => set((d) => { d.warnExpiryDays = Number(e.target.value); })}>
              {EXPIRY_CHOICES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>/ban deletes messages from the</span>
            <select value={draft.banDeleteDays} onChange={(e) => set((d) => { d.banDeleteDays = Number(e.target.value); })}>
              {BAN_DELETE_CHOICES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
            </select>
          </label>
        </div>
        {draft.escalation.map((step, i) => (
          <StepRow
            key={i}
            step={step}
            taken={usedCounts}
            onChange={(fn) => set((d) => fn(d.escalation[i]))}
            onRemove={() => set((d) => { d.escalation.splice(i, 1); })}
          />
        ))}
        {draft.escalation.length === 0 && <p className="muted small">No automatic steps. Warnings are recorded only.</p>}
        {draft.escalation.length < MAX_ESCALATION_STEPS && (
          <button
            className="link add-row"
            onClick={() => set((d) => { d.escalation.push({ warnings: nextCount(), action: "timeout", durationMinutes: 60 }); })}
          >
            + Add a step
          </button>
        )}
      </section>

      <section className="sub">
        <div className="sub-head"><strong>Commands</strong><small className="muted">Each one is limited to staff with the matching Discord permission. Fine-tune who can use them in Server Settings → Integrations → Number One.</small></div>
        <div className="mod-commands">
          {COMMANDS.map(([name, what]) => (
            <div key={name}><code>{name}</code><span className="muted small">{what}</span></div>
          ))}
        </div>
      </section>

      {error && <p className="error">{error}</p>}
      {dirty && (
        <div className="save-bar">
          <span>You have unsaved changes.</span>
          <button className="btn ghost small" disabled={saving} onClick={() => setDraft(structuredClone(data.settings))}>Discard</button>
          <button className="btn primary small" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}

      <CaseList guild={guild} />
    </div>
  );
}

function StepRow({
  step,
  taken,
  onChange,
  onRemove,
}: {
  step: EscalationStep;
  taken: Set<number>;
  onChange: (fn: (s: EscalationStep) => void) => void;
  onRemove: () => void;
}) {
  const counts = Array.from({ length: 20 }, (_, i) => i + 1);
  const durations = step.action === "timeout" ? durationChoices.filter((c) => c.minutes <= 28 * 24 * 60) : durationChoices;
  return (
    <div className="mod-step">
      <span className="muted small">At</span>
      <select value={step.warnings} onChange={(e) => onChange((s) => { s.warnings = Number(e.target.value); })}>
        {counts.map((n) => (
          <option key={n} value={n} disabled={n !== step.warnings && taken.has(n)}>
            {n} warning{n === 1 ? "" : "s"}
          </option>
        ))}
      </select>
      <select
        value={step.action}
        onChange={(e) =>
          onChange((s) => {
            s.action = e.target.value as EscalationStep["action"];
            if (s.action === "timeout" && (s.durationMinutes < 1 || s.durationMinutes > 28 * 24 * 60)) s.durationMinutes = 60;
          })
        }
      >
        <option value="timeout">Time out</option>
        <option value="kick">Kick</option>
        <option value="ban">Ban</option>
      </select>
      {step.action === "kick" ? (
        <span />
      ) : (
        <select value={step.durationMinutes} onChange={(e) => onChange((s) => { s.durationMinutes = Number(e.target.value); })}>
          {step.action === "ban" && <option value={0}>Permanently</option>}
          {!durations.some((c) => c.minutes === step.durationMinutes) && step.durationMinutes > 0 && (
            <option value={step.durationMinutes}>for {formatDuration(step.durationMinutes * 60_000)}</option>
          )}
          {durations.map((c) => <option key={c.minutes} value={c.minutes}>for {c.label}</option>)}
        </select>
      )}
      <button className="icon-btn small" aria-label="Remove step" onClick={onRemove}>×</button>
    </div>
  );
}

/* ------------------------------------------------------------------ cases */

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function CaseList({ guild }: { guild: Guild }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<CaseAction | "">("");
  const [cases, setCases] = useState<CaseView[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    (before: number | null) => api.cases(guild.id, { q: query.trim(), action, before }),
    [guild.id, query, action],
  );

  // Reload when the filters change (typing waits a moment so it doesn't fire on every key).
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPage(null)
        .then((r) => {
          setCases(r.cases);
          setNext(r.nextBefore);
          setError("");
        })
        .catch((err) => setError(err.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [fetchPage]);

  const more = async () => {
    setLoadingMore(true);
    try {
      const r = await fetchPage(next);
      setCases((c) => [...(c ?? []), ...r.cases]);
      setNext(r.nextBefore);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const replace = (n: number, updated: CaseView | null) =>
    setCases((list) => (list ?? []).flatMap((c) => (c.caseNumber !== n ? [c] : updated ? [updated] : [])));

  return (
    <section className="sub mod-cases">
      <div className="sub-head">
        <strong>Cases</strong>
        <small className="muted">Everything Number One's moderation has recorded. Search by name, user ID, moderator or reason.</small>
      </div>
      <div className="mod-filters">
        <input type="search" placeholder="Search cases…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={action} onChange={(e) => setAction(e.target.value as CaseAction | "")}>
          <option value="">All kinds</option>
          {caseActions.map((a) => <option key={a} value={a}>{actionInfo[a].emoji} {actionInfo[a].label}</option>)}
        </select>
      </div>
      {error && <p className="error small">{error}</p>}
      {!cases && !error && <p className="muted small">Loading cases…</p>}
      {cases && cases.length === 0 && (
        <p className="muted small">{query || action ? "No cases match." : "No cases yet. They'll show up here as soon as a moderator acts."}</p>
      )}
      <div className="mod-case-list">
        {cases?.map((c) => (
          <CaseCard
            key={c.caseNumber}
            guildId={guild.id}
            c={c}
            onChanged={(u) => replace(c.caseNumber, u)}
            onLifted={(lift) => {
              setCases((list) => [lift, ...(list ?? []).map((x) => (x.caseNumber === c.caseNumber ? { ...x, active: false } : x))]);
            }}
            onError={setError}
          />
        ))}
      </div>
      {next && (
        <button className="btn ghost small" disabled={loadingMore} onClick={more}>
          {loadingMore ? "Loading…" : "Load older cases"}
        </button>
      )}
    </section>
  );
}

function CaseCard({
  guildId,
  c,
  onChanged,
  onLifted,
  onError,
}: {
  guildId: string;
  c: CaseView;
  onChanged: (updated: CaseView | null) => void;
  onLifted: (liftCase: CaseView) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(c.reason);
  const [busy, setBusy] = useState(false);
  const info = actionInfo[c.action];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    onError("");
    try {
      await fn();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tags: string[] = [];
  if (c.auto) tags.push("Automatic");
  if (c.external) tags.push("In Discord");
  if (c.active) tags.push(c.action === "ban" ? "Active ban" : "Active timeout");

  return (
    <div className={`mod-case ${c.active ? "active" : ""}`} style={{ borderLeftColor: `#${info.color.toString(16).padStart(6, "0")}` }}>
      <div className="mod-case-head">
        <span className="mod-case-title">
          <span>{info.emoji}</span>
          <strong>#{c.caseNumber} {info.label}</strong>
          {c.durationMs ? <span className="muted small">{formatDuration(c.durationMs)}</span> : c.action === "ban" ? <span className="muted small">Permanent</span> : null}
          {tags.map((t) => <span key={t} className="pill tiny">{t}</span>)}
        </span>
        <span className="muted small">{when(c.createdAt)}</span>
      </div>
      <div className="mod-case-meta small">
        <span><span className="muted">Member</span> {c.userTag} <code>{c.userId}</code></span>
        <span><span className="muted">By</span> {c.auto ? "Number One" : c.moderatorTag}</span>
        {c.active && c.expiresAt && <span><span className="muted">Ends</span> {when(c.expiresAt)}</span>}
      </div>
      {editing ? (
        <div className="mod-case-edit">
          <textarea rows={2} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="editor-actions">
            <button
              className="btn primary small"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  onChanged(await api.editCase(guildId, c.caseNumber, reason));
                  setEditing(false);
                })
              }
            >
              Save reason
            </button>
            <button className="btn ghost small" disabled={busy} onClick={() => { setReason(c.reason); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mod-case-reason">{c.reason || <span className="muted">No reason given</span>}</p>
      )}
      {!editing && (
        <div className="mod-case-actions">
          <button className="link small" disabled={busy} onClick={() => setEditing(true)}>Edit reason</button>
          {c.logUrl && <a className="small" href={c.logUrl} target="_blank" rel="noreferrer">Mod log post</a>}
          {c.active && (
            <button
              className="link small"
              disabled={busy}
              onClick={() =>
                confirm(c.action === "ban" ? `Unban ${c.userTag} now?` : `End ${c.userTag}'s timeout now?`) &&
                run(async () => onLifted(await api.liftCase(guildId, c.caseNumber)))
              }
            >
              {c.action === "ban" ? "Unban now" : "End timeout"}
            </button>
          )}
          <button
            className="link small danger-link"
            disabled={busy}
            onClick={() =>
              confirm(
                `Delete case #${c.caseNumber}? It's removed from ${c.userTag}'s history and stops counting towards automatic steps.` +
                  (c.active ? " The ban or timeout itself stays in place." : ""),
              ) &&
              run(async () => {
                await api.deleteCase(guildId, c.caseNumber);
                onChanged(null);
              })
            }
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
