import { useEffect, useState } from "react";
import {
  MAX_OPTIONS,
  MAX_ACCESS_CHANNELS,
  MAX_QUESTIONS,
  MAX_ROLES_PER_OPTION,
  MAX_STAFF_CATEGORIES,
  type OnboardingQuestion,
  type OnboardingSettings,
  PLACEHOLDERS,
} from "../../../src/shared/onboarding";
import { type GuildDetails, type OnboardingResponse, api } from "../api";
import { EmojiInput } from "../components/emoji";
import { ChannelPicker, ChannelSelect, RolePicker, RoleSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];
type Option = OnboardingQuestion["options"][number];

const newId = () => Math.random().toString(36).slice(2, 10);
const blankOption = (): Option => ({ id: newId(), label: "", description: "", emoji: "", roleIds: [] });
const blankQuestion = (): OnboardingQuestion => ({
  id: newId(),
  title: "",
  description: "",
  multiple: false,
  required: false,
  options: [blankOption(), blankOption()],
});

const KICK_CHOICES = [
  { hours: 0, label: "Never" },
  { hours: 1, label: "After 1 hour" },
  { hours: 6, label: "After 6 hours" },
  { hours: 24, label: "After 1 day" },
  { hours: 72, label: "After 3 days" },
  { hours: 168, label: "After 1 week" },
];

/** Dashboard section for Member onboarding. Every part is optional and switched on separately. */
export function OnboardingPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [draft, setDraft] = useState<OnboardingSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);
  /** The "make it private" confirmation: closed, open, or open with the box ticked. */
  const [confirmPrivate, setConfirmPrivate] = useState<"closed" | "open" | "ticked">("closed");

  const load = (r: OnboardingResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api
      .onboarding(guild.id)
      .then((r) => {
        load(r);
        if (r.warnings.length) setNotice({ text: "Heads up:", warnings: r.warnings });
      })
      .catch((err) => setError(err.message));
  }, [guild.id]);

  // While private mode is being switched on, check progress every 2 seconds.
  const jobPhase = data?.status.privateJob?.phase;
  useEffect(() => {
    if (jobPhase !== "roles" && jobPhase !== "channels") return;
    const timer = setInterval(() => {
      api
        .onboarding(guild.id)
        .then((r) => setData((prev) => (prev ? { ...prev, status: r.status, privatePlan: r.privatePlan } : r)))
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [guild.id, jobPhase]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading onboarding…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: OnboardingSettings) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await api.saveOnboarding(guild.id, draft);
      load(r);
      setNotice({ text: "Saved.", warnings: r.warnings });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const gateAction = async (kind: "setup" | "remove") => {
    if (dirty) return setError("Save or discard your changes first.");
    const question =
      kind === "setup"
        ? `This will:\n\n• ${data.gatePlan.join("\n• ")}\n\nContinue?`
        : "Make all channels visible to new members again? The New member role is kept.";
    if (!confirm(question)) return;
    setSaving(true);
    setError("");
    try {
      const r = kind === "setup" ? await api.setUpGate(guild.id) : await api.removeGate(guild.id);
      load(r);
      setNotice({ text: kind === "setup" ? "The access gate is set up." : "The access gate is off.", warnings: r.warnings });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const privateAction = async (kind: "start" | "stop") => {
    if (dirty) return setError("Save or discard your changes first.");
    if (kind === "stop" && !confirm("Turn off private mode? Every channel goes back to how it was before. Members keep the Verified role.")) return;
    setSaving(true);
    setError("");
    try {
      const r = kind === "start" ? await api.startPrivateMode(guild.id) : await api.stopPrivateMode(guild.id);
      load(r);
      setConfirmPrivate("closed");
      setNotice(kind === "start" ? null : { text: "Private mode is off.", warnings: r.warnings });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const { status } = data;
  const flowOn = draft.flow.enabled;
  const access = draft.access;
  const canAccess = data.canManageAccess;
  const job = status.privateJob;
  const jobRunning = job?.phase === "roles" || job?.phase === "channels";

  // Why a channel can't be picked in a list (it's in a staff category, or already in the other list).
  const staffIds = new Set(access.staffCategoryIds);
  const blocked = (other: string[], otherName: string) => {
    const out: Record<string, string> = {};
    for (const c of guild.channels) {
      if (staffIds.has(c.id) || (c.parentId && staffIds.has(c.parentId))) out[c.id] = "staff";
      else if (other.includes(c.id)) out[c.id] = otherName;
    }
    return out;
  };

  return (
    <div className="panel onboarding">
      {status.communityOnboarding && (
        <div className="notice warning-box">
          This server has Discord's Community features on. If Discord's own Onboarding is also switched on, members will
          see both. Use one or the other.
        </div>
      )}

      <div className="stats">
        <div><strong>{status.activity.joinedLast7Days}</strong><span className="muted small">joined this week</span></div>
        <div><strong>{status.activity.completedLast7Days}</strong><span className="muted small">finished onboarding</span></div>
        <div><strong>{status.activity.pending}</strong><span className="muted small">still pending</span></div>
        {status.counts.verified !== null && (
          <div><strong>{status.counts.verified}</strong><span className="muted small">verified members</span></div>
        )}
        {status.counts.atGate !== null && (
          <div><strong>{status.counts.atGate}</strong><span className="muted small">at the gate now</span></div>
        )}
      </div>

      {notice && (
        <div className="notice">
          <span>{notice.text}</span>
          {notice.warnings.map((w) => <div key={w} className="warning">⚠️ {w}</div>)}
          <button className="link small" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {/* 1. Welcome */}
      <section className="sub">
        <Toggle
          label="Welcome message"
          hint="Greet new members in a channel."
          checked={draft.welcome.enabled}
          onChange={(v) => set((d) => { d.welcome.enabled = v; })}
        />
        {draft.welcome.enabled && (
          <div className="sub-body">
            <label className="field">
              <span>Channel</span>
              <ChannelSelect
                guild={guild}
                value={draft.welcome.channelId}
                emptyLabel="Server's system channel"
                onChange={(v) => set((d) => { d.welcome.channelId = v; })}
              />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea rows={3} maxLength={1800} value={draft.welcome.message} onChange={(e) => set((d) => { d.welcome.message = e.target.value; })} />
              <Placeholders />
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.welcome.useEmbed} onChange={(e) => set((d) => { d.welcome.useEmbed = e.target.checked; })} />
              <span><strong>Show as a card</strong><small className="muted">A pink card with the member's avatar instead of plain text.</small></span>
            </label>
            {flowOn && (
              <label className="field">
                <span>When to post it</span>
                <select value={draft.welcome.when} onChange={(e) => set((d) => { d.welcome.when = e.target.value as "join" | "complete"; })}>
                  <option value="join">As soon as they join</option>
                  <option value="complete">After they finish onboarding</option>
                </select>
              </label>
            )}
            <Toggle
              label="Also send a welcome DM"
              hint="Some members block DMs; they simply won't get it."
              checked={draft.welcome.dmEnabled}
              onChange={(v) => set((d) => { d.welcome.dmEnabled = v; })}
            />
            {draft.welcome.dmEnabled && (
              <label className="field">
                <span>DM message</span>
                <textarea rows={2} maxLength={1800} value={draft.welcome.dmMessage} onChange={(e) => set((d) => { d.welcome.dmMessage = e.target.value; })} />
              </label>
            )}
          </div>
        )}
      </section>

      {/* 2. Goodbye */}
      <section className="sub">
        <Toggle
          label="Goodbye message"
          hint="Post a message when someone leaves. Off by default."
          checked={draft.goodbye.enabled}
          onChange={(v) => set((d) => { d.goodbye.enabled = v; })}
        />
        {draft.goodbye.enabled && (
          <div className="sub-body">
            <label className="field">
              <span>Channel</span>
              <ChannelSelect guild={guild} value={draft.goodbye.channelId} emptyLabel="Server's system channel" onChange={(v) => set((d) => { d.goodbye.channelId = v; })} />
            </label>
            <label className="field">
              <span>Message</span>
              <textarea rows={2} maxLength={1800} value={draft.goodbye.message} onChange={(e) => set((d) => { d.goodbye.message = e.target.value; })} />
            </label>
          </div>
        )}
      </section>

      {/* 3. Join roles */}
      <section className="sub">
        <div className="sub-head"><strong>Join roles</strong><small className="muted">Given to every new member right away.</small></div>
        <RolePicker guild={guild} value={draft.joinRoles} onChange={(v) => set((d) => { d.joinRoles = v; })} />
        <div className="sub-head spaced"><strong>Bot roles</strong><small className="muted">Given to bots that join. Bots skip onboarding.</small></div>
        <RolePicker guild={guild} value={draft.botRoles} onChange={(v) => set((d) => { d.botRoles = v; })} />
      </section>

      {/* 4. Onboarding steps */}
      <section className="sub">
        <Toggle
          label="Onboarding steps"
          hint="New members click Start for a private walkthrough: rules, then questions that give roles. With neither, they just click Finish."
          checked={draft.flow.enabled}
          onChange={(v) => set((d) => { d.flow.enabled = v; })}
        />
        {!flowOn && draft.gate.enabled && (
          <p className="error small">The access gate is on, so new members need these steps to get in. Turn the gate off first.</p>
        )}
        {flowOn && (
          <div className="sub-body">
            <label className="field">
              <span>Channel for the Start button</span>
              <ChannelSelect guild={guild} value={draft.flow.channelId} onChange={(v) => set((d) => { d.flow.channelId = v; })} />
              {status.startMessageUrl && (
                <small><a href={status.startMessageUrl} target="_blank" rel="noreferrer">View the Start message in Discord</a></small>
              )}
            </label>
            <label className="field">
              <span>Intro text</span>
              <textarea rows={2} maxLength={1500} value={draft.flow.intro} onChange={(e) => set((d) => { d.flow.intro = e.target.value; })} />
            </label>

            <Toggle
              label="Rules"
              hint="Members must agree before continuing."
              checked={draft.flow.rulesEnabled}
              onChange={(v) => set((d) => { d.flow.rulesEnabled = v; })}
            />
            {draft.flow.rulesEnabled && (
              <label className="field">
                <textarea rows={5} maxLength={3500} placeholder={"1. Be kind.\n2. No spam.\n3. Keep it on topic."} value={draft.flow.rules} onChange={(e) => set((d) => { d.flow.rules = e.target.value; })} />
              </label>
            )}

            <div className="sub-head spaced">
              <strong>Questions</strong>
              <small className="muted">Each answer can give roles. Up to {MAX_QUESTIONS} questions with {MAX_OPTIONS} answers each.</small>
            </div>
            {draft.flow.questions.map((q, qi) => (
              <QuestionEditor
                key={q.id}
                guild={guild}
                question={q}
                index={qi}
                count={draft.flow.questions.length}
                onChange={(fn) => set((d) => fn(d.flow.questions[qi]))}
                onMove={(dir) => set((d) => {
                  const [item] = d.flow.questions.splice(qi, 1);
                  d.flow.questions.splice(qi + dir, 0, item);
                })}
                onRemove={() => set((d) => { d.flow.questions.splice(qi, 1); })}
              />
            ))}
            {draft.flow.questions.length < MAX_QUESTIONS && (
              <button className="btn ghost small" onClick={() => set((d) => { d.flow.questions.push(blankQuestion()); })}>
                + Add a question
              </button>
            )}
          </div>
        )}
      </section>

      {/* 5. Access gate */}
      <section className="sub">
        <div className="sub-head">
          <strong>Access gate</strong>
          <small className="muted">
            Hide the rest of the server from new members until they finish onboarding. Optional. Existing members aren't affected.
          </small>
        </div>
        {draft.gate.enabled ? (
          <div className="sub-body">
            <p className="small">
              🔒 On. {status.hiddenChannels} of {status.totalChannels} channels are hidden from new members.
            </p>
            <label className="field">
              <span>New member role</span>
              <RoleSelect guild={guild} value={draft.gate.roleId} onChange={(v) => set((d) => { d.gate.roleId = v; })} />
              <small className="muted">Members hold this role until they finish. It's removed automatically.</small>
            </label>
            <label className="field">
              <span>Remove members who don't finish</span>
              <select value={draft.gate.kickAfterHours} onChange={(e) => set((d) => { d.gate.kickAfterHours = Number(e.target.value); })}>
                {KICK_CHOICES.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
              </select>
            </label>
            <div className="editor-actions">
              <button className="btn ghost small" disabled={saving} onClick={() => gateAction("setup")}>Re-check hidden channels</button>
              <button className="btn danger small" disabled={saving} onClick={() => gateAction("remove")}>Turn off the gate</button>
            </div>
          </div>
        ) : (
          <div className="sub-body">
            <button className="btn primary small" disabled={saving} onClick={() => gateAction("setup")}>Set it up for me</button>
            <small className="muted">You'll see exactly what changes before anything happens.</small>
          </div>
        )}
      </section>

      {/* 6. Channel access */}
      <section className="sub">
        <div className="sub-head">
          <strong>Channel access</strong>
          <small className="muted">Choose who sees which channels. Number One sets the permissions for you.</small>
        </div>
        {!canAccess && <p className="small muted">🔒 Only the server owner can change channel access.</p>}
        <div className="sub-body">
          <label className="field">
            <span>Staff categories</span>
            <ChannelPicker
              guild={guild}
              kind="categories"
              max={MAX_STAFF_CATEGORIES}
              placeholder="Add a staff category…"
              disabled={!canAccess}
              value={access.staffCategoryIds}
              onChange={(v) => set((d) => { d.access.staffCategoryIds = v; })}
            />
            <small className="muted">Number One never changes these categories or anything inside them.</small>
          </label>
          <label className="field">
            <span>Public channels</span>
            <ChannelPicker
              guild={guild}
              max={MAX_ACCESS_CHANNELS}
              disabled={!canAccess}
              exclude={blocked(access.newMemberChannelIds, "new-member-only")}
              value={access.publicChannelIds}
              onChange={(v) => set((d) => { d.access.publicChannelIds = v; })}
            />
            <small className="muted">Everyone can see these, including members still onboarding (e.g. #rules, #announcements). Picking a category covers its channels.</small>
          </label>
          <label className="field">
            <span>New-member-only channels</span>
            <ChannelPicker
              guild={guild}
              max={MAX_ACCESS_CHANNELS}
              disabled={!canAccess || (!draft.gate.enabled && !access.newMemberChannelIds.length)}
              exclude={blocked(access.publicChannelIds, "public")}
              value={access.newMemberChannelIds}
              onChange={(v) => set((d) => { d.access.newMemberChannelIds = v; })}
            />
            <small className="muted">
              {draft.gate.enabled
                ? "Only members still onboarding can see these. They disappear once they finish (e.g. #introduce-yourself, #new-member-help)."
                : "Set up the access gate first. It gives new members the role these channels are shown to."}
            </small>
          </label>
          <label className="field">
            <span>Verified role</span>
            <RoleSelect
              guild={guild}
              value={access.verifiedRoleId}
              emptyLabel="None (one is created when you turn on private mode)"
              onChange={(v) => canAccess && set((d) => { d.access.verifiedRoleId = v; })}
            />
            <small className="muted">
              Given to members when they finish onboarding.{" "}
              {canAccess && access.verifiedRoleId && !status.privateMode && (
                <button className="link small" onClick={() => set((d) => { d.access.verifiedRoleId = null; })}>Clear</button>
              )}
            </small>
          </label>

          <div className="private-box">
            <strong>Private mode</strong>
            {jobRunning ? (
              <p className="small">
                ⏳{" "}
                {job!.phase === "roles"
                  ? `Giving the Verified role to current members so nobody loses access: ${job!.done} of ${job!.total || "…"}.`
                  : "Making channels private…"}{" "}
                You can leave this page; it keeps going.
              </p>
            ) : status.privateMode ? (
              <>
                <p className="small">
                  🔐 On. {status.privateChannels} channel{status.privateChannels === 1 ? " is" : "s are"} only visible to Verified members.
                </p>
                {canAccess && (
                  <div className="editor-actions">
                    <button className="btn danger small" disabled={saving} onClick={() => privateAction("stop")}>Turn off private mode</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="small muted">
                  Optional. Every channel not listed above becomes visible only to members with the Verified role.
                  Channels that are already private are left alone.
                </p>
                {job?.phase === "failed" && <p className="error small">{job.error}</p>}
                {canAccess && confirmPrivate === "closed" && (
                  <button className="btn primary small" disabled={saving} onClick={() => (dirty ? setError("Save or discard your changes first.") : setConfirmPrivate("open"))}>
                    Make the rest of the server private…
                  </button>
                )}
                {canAccess && confirmPrivate !== "closed" && (
                  <div className="confirm-box">
                    <strong>Here's exactly what will happen:</strong>
                    <ol className="small">{data.privatePlan.map((step) => <li key={step}>{step}</li>)}</ol>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={confirmPrivate === "ticked"}
                        onChange={(e) => setConfirmPrivate(e.target.checked ? "ticked" : "open")}
                      />
                      <span>I understand that anyone without the Verified role will only see the channels listed above.</span>
                    </label>
                    <div className="editor-actions">
                      <button className="btn ghost small" disabled={saving} onClick={() => setConfirmPrivate("closed")}>Cancel</button>
                      <button className="btn danger small" disabled={saving || confirmPrivate !== "ticked"} onClick={() => privateAction("start")}>
                        {saving ? "Starting…" : "Yes, make it private"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
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
    </div>
  );
}

function Placeholders() {
  return (
    <small className="muted">
      You can use{" "}
      {PLACEHOLDERS.map((p, i) => (
        <span key={p.key} title={p.means}>
          <code>{p.key}</code>
          {i < PLACEHOLDERS.length - 1 ? " " : ""}
        </span>
      ))}
    </small>
  );
}

function QuestionEditor({
  guild,
  question: q,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  guild: Guild;
  question: OnboardingQuestion;
  index: number;
  count: number;
  onChange: (fn: (q: OnboardingQuestion) => void) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="question">
      <div className="question-head">
        <span className="muted small">Question {index + 1}</span>
        <div className="rr-actions">
          <button className="icon-btn small" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button className="icon-btn small" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
          <button className="icon-btn small" aria-label="Delete question" onClick={() => confirm("Delete this question?") && onRemove()}>×</button>
        </div>
      </div>
      <input placeholder="What are you interested in?" maxLength={100} value={q.title} onChange={(e) => onChange((x) => { x.title = e.target.value; })} />
      <input placeholder="Extra detail (optional)" maxLength={300} value={q.description} onChange={(e) => onChange((x) => { x.description = e.target.value; })} />
      <div className="inline-checks">
        <label className="check"><input type="checkbox" checked={q.multiple} onChange={(e) => onChange((x) => { x.multiple = e.target.checked; })} /><span>Allow several answers</span></label>
        <label className="check"><input type="checkbox" checked={q.required} onChange={(e) => onChange((x) => { x.required = e.target.checked; })} /><span>Required</span></label>
      </div>
      {q.options.map((o, oi) => (
        <div key={o.id} className="option-row">
          <EmojiInput guild={guild} value={o.emoji} onChange={(v) => onChange((x) => { x.options[oi].emoji = v; })} />
          <input placeholder="Answer" maxLength={80} value={o.label} onChange={(e) => onChange((x) => { x.options[oi].label = e.target.value; })} />
          <RolePicker
            guild={guild}
            value={o.roleIds}
            max={MAX_ROLES_PER_OPTION}
            placeholder="Gives role…"
            onChange={(v) => onChange((x) => { x.options[oi].roleIds = v; })}
          />
          <button
            className="icon-btn"
            aria-label="Remove answer"
            disabled={q.options.length <= 1}
            onClick={() => onChange((x) => { x.options.splice(oi, 1); })}
          >
            ×
          </button>
        </div>
      ))}
      {q.options.length < MAX_OPTIONS && (
        <button className="link small add-row" onClick={() => onChange((x) => { x.options.push(blankOption()); })}>+ Add an answer</button>
      )}
    </div>
  );
}
