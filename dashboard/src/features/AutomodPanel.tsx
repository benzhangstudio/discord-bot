import { type ReactNode, useEffect, useState } from "react";
import {
  type AutomodAction,
  type AutomodResponse,
  type AutomodRuleKey,
  type AutomodSettings,
  MAX_ALLOWED_DOMAINS,
  MAX_ALLOWED_WORDS,
  MAX_BLOCKED_WORDS,
  MAX_IGNORED_CHANNELS,
  MAX_IGNORED_ROLES,
  automodActionInfo,
  automodActions,
  botRules,
  discordRules,
  ruleInfo,
} from "../../../src/shared/automod";
import { durationChoices, formatDuration } from "../../../src/shared/moderation";
import { type GuildDetails, api } from "../api";
import { ChannelPicker, ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];
type Draft = AutomodSettings;

const TIMEOUT_CHOICES = durationChoices.filter((c) => c.minutes <= 28 * 24 * 60);

/** Dashboard section for Auto-moderation: alert channel, then one card per filter. */
export function AutomodPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<AutomodResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = (r: AutomodResponse) => {
    setData(r);
    setDraft(structuredClone(r.settings));
  };

  useEffect(() => {
    api.automod(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading auto-moderation…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (fn: (d: Draft) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      load(await api.saveAutomod(guild.id, draft));
      setNotice("Saved. Discord's AutoMod rules are updated.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const { status } = data;
  const card = (key: AutomodRuleKey, extra?: ReactNode) => (
    <RuleCard key={key} ruleKey={key} guild={guild} draft={draft} set={set} paused={botRules.includes(key as never) && !status.canReadMessages}>
      {extra}
    </RuleCard>
  );

  return (
    <div className="panel moderation automod">
      <div className="stats mod-stats">
        <div><strong>{status.discordRulesActive}</strong><span className="muted small">Discord AutoMod rules running</span></div>
        <div><strong>{status.caughtSinceRestart}</strong><span className="muted small">caught by my filters since restart</span></div>
        <div><strong>{status.canReadMessages ? "Yes" : "No"}</strong><span className="muted small">I can read messages</span></div>
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

      <section className="sub">
        <div className="sub-head">
          <strong>Alerts</strong>
          <small className="muted">A short note with the caught message is posted here each time a filter catches something. Warnings, timeouts and kicks also go to Moderation's mod log as cases.</small>
        </div>
        <ChannelSelect guild={guild} value={draft.alertChannelId} emptyLabel="No alerts" onChange={(v) => set((d) => { d.alertChannelId = v; })} />
      </section>

      <div className="automod-group-head">
        <h3>Discord AutoMod filters</h3>
        <p className="muted small">
          These become rules in Discord's own AutoMod (Server Settings → AutoMod). Discord blocks the message before anyone sees it, even while
          Number One is offline. Admins and people with Manage Server are never filtered.
        </p>
      </div>
      {discordRules.map((key) =>
        card(
          key,
          key === "words" ? (
            <WordsFields draft={draft} set={set} />
          ) : key === "links" ? (
            <WordList
              label="Always allowed sites"
              hint={`One per line, like youtube.com. Subdomains are allowed too. Up to ${MAX_ALLOWED_DOMAINS}.`}
              placeholder={"youtube.com\ntenor.com"}
              value={draft.links.allowedDomains}
              max={MAX_ALLOWED_DOMAINS}
              onChange={(v) => set((d) => { d.links.allowedDomains = v; })}
            />
          ) : key === "mentions" ? (
            <>
              <label className="field">
                <span>Most mentions allowed in one message</span>
                <input
                  type="number"
                  min={2}
                  max={50}
                  value={draft.mentions.limit}
                  onChange={(e) => set((d) => { d.mentions.limit = clamp(e.target.valueAsNumber, 2, 50); })}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.mentions.raidProtection} onChange={(e) => set((d) => { d.mentions.raidProtection = e.target.checked; })} />
                <span><strong>Mention raid protection</strong><small className="muted">Discord also watches for a sudden wave of mention spam across the server.</small></span>
              </label>
            </>
          ) : null,
        ),
      )}

      <div className="automod-group-head">
        <h3>Number One filters</h3>
        <p className="muted small">
          Things Discord's AutoMod can't check. Number One reads each message and deletes the ones that break a rule, so these only work while
          it's online. Edited messages are checked too. Admins and people with Manage Server are never filtered.
        </p>
      </div>
      {botRules.map((key) =>
        card(
          key,
          key === "caps" ? (
            <div className="mod-row">
              <label className="field">
                <span>Capital letters (%)</span>
                <input type="number" min={50} max={100} value={draft.caps.percent} onChange={(e) => set((d) => { d.caps.percent = clamp(e.target.valueAsNumber, 50, 100); })} />
              </label>
              <label className="field">
                <span>Only check messages with at least this many letters</span>
                <input type="number" min={5} max={200} value={draft.caps.minLetters} onChange={(e) => set((d) => { d.caps.minLetters = clamp(e.target.valueAsNumber, 5, 200); })} />
              </label>
            </div>
          ) : key === "emoji" ? (
            <label className="field">
              <span>Most emojis allowed in one message</span>
              <input type="number" min={3} max={100} value={draft.emoji.max} onChange={(e) => set((d) => { d.emoji.max = clamp(e.target.valueAsNumber, 3, 100); })} />
            </label>
          ) : key === "repeated" ? (
            <div className="mod-row">
              <label className="field">
                <span>Same message this many times</span>
                <input type="number" min={2} max={10} value={draft.repeated.count} onChange={(e) => set((d) => { d.repeated.count = clamp(e.target.valueAsNumber, 2, 10); })} />
              </label>
              <label className="field">
                <span>Within (seconds)</span>
                <input type="number" min={5} max={600} value={draft.repeated.seconds} onChange={(e) => set((d) => { d.repeated.seconds = clamp(e.target.valueAsNumber, 5, 600); })} />
              </label>
            </div>
          ) : null,
        ),
      )}

      {error && <p className="error">{error}</p>}
      {dirty && (
        <div className="save-bar">
          <span>You have unsaved changes.</span>
          <button className="btn ghost small" disabled={saving} onClick={() => { setDraft(structuredClone(data.settings)); setError(""); }}>Discard</button>
          <button className="btn primary small" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </div>
  );
}

const clamp = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);

/** One filter: on/off, its own fields, then what happens and who it skips. */
function RuleCard({
  ruleKey,
  guild,
  draft,
  set,
  paused,
  children,
}: {
  ruleKey: AutomodRuleKey;
  guild: Guild;
  draft: Draft;
  set: (fn: (d: Draft) => void) => void;
  paused: boolean;
  children?: ReactNode;
}) {
  const rule = draft[ruleKey];
  const info = ruleInfo[ruleKey];
  const update = (fn: (r: typeof rule) => void) => set((d) => fn(d[ruleKey]));
  const timeoutKnown = TIMEOUT_CHOICES.some((c) => c.minutes === rule.timeoutMinutes);

  return (
    <section className="sub automod-rule">
      <Toggle
        label={`${info.emoji} ${info.name}`}
        hint={paused && rule.enabled ? `${info.description} Paused: I can't read messages yet (see above).` : info.description}
        checked={rule.enabled}
        onChange={(v) => update((r) => { r.enabled = v; })}
      />
      {rule.enabled && (
        <div className="sub-body automod-body">
          {children}
          <div className="mod-row">
            <label className="field">
              <span>When it catches something</span>
              <select value={rule.action} onChange={(e) => update((r) => { r.action = e.target.value as AutomodAction; })}>
                {automodActions.map((a) => <option key={a} value={a}>{automodActionInfo[a].label}</option>)}
              </select>
              <small className="muted">{automodActionInfo[rule.action].hint}</small>
            </label>
            {rule.action === "timeout" && (
              <label className="field">
                <span>Timeout length</span>
                <select value={rule.timeoutMinutes} onChange={(e) => update((r) => { r.timeoutMinutes = Number(e.target.value); })}>
                  {!timeoutKnown && <option value={rule.timeoutMinutes}>{formatDuration(rule.timeoutMinutes * 60_000)}</option>}
                  {TIMEOUT_CHOICES.map((c) => <option key={c.minutes} value={c.minutes}>{c.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="mod-row">
            <div className="field">
              <span>Skip these channels</span>
              <ChannelPicker
                guild={guild}
                value={rule.ignoredChannelIds}
                max={MAX_IGNORED_CHANNELS}
                onChange={(v) => update((r) => { r.ignoredChannelIds = v; })}
              />
            </div>
            <div className="field">
              <span>Skip these roles</span>
              <RolePicker
                guild={guild}
                anyRole
                value={rule.ignoredRoleIds}
                max={MAX_IGNORED_ROLES}
                onChange={(v) => update((r) => { r.ignoredRoleIds = v; })}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function WordsFields({ draft, set }: { draft: Draft; set: (fn: (d: Draft) => void) => void }) {
  const w = draft.words;
  return (
    <>
      <WordList
        label="Blocked words and phrases"
        hint={`One per line. Plain words match whole words only. Use * for parts of words: bad* (starts with), *bad (ends with), *bad* (anywhere). Up to ${MAX_BLOCKED_WORDS}.`}
        placeholder={"badword\nscam*\n*free nitro*"}
        value={w.blocked}
        max={MAX_BLOCKED_WORDS}
        onChange={(v) => set((d) => { d.words.blocked = v; })}
      />
      <div className="inline-checks">
        <span className="muted small">Also block Discord's own lists:</span>
        <label className="check">
          <input type="checkbox" checked={w.profanity} onChange={(e) => set((d) => { d.words.profanity = e.target.checked; })} />
          <span>Swearing</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={w.sexualContent} onChange={(e) => set((d) => { d.words.sexualContent = e.target.checked; })} />
          <span>Sexual content</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={w.slurs} onChange={(e) => set((d) => { d.words.slurs = e.target.checked; })} />
          <span>Slurs and insults</span>
        </label>
      </div>
      {(w.profanity || w.sexualContent || w.slurs) && w.action === "timeout" && (
        <small className="muted">Discord can't time people out for its own lists, so Number One does it instead (only while it's online).</small>
      )}
      <WordList
        label="Never block"
        hint={`Words that look like a blocked word but are fine, like "scunthorpe". Up to ${MAX_ALLOWED_WORDS}.`}
        value={w.allowed}
        max={MAX_ALLOWED_WORDS}
        onChange={(v) => set((d) => { d.words.allowed = v; })}
      />
    </>
  );
}

const toList = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** A textarea holding one entry per line (commas work too). */
function WordList({
  label,
  hint,
  placeholder,
  value,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder?: string;
  value: string[];
  max: number;
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  // Follow outside changes (Discard, or the server tidying the list on save) without fighting the typing.
  useEffect(() => {
    if (JSON.stringify(toList(text)) !== JSON.stringify(value)) setText(value.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const count = toList(text).length;
  return (
    <label className="field">
      <span>
        {label} <small className={count > max ? "error" : "muted"}>({count}/{max})</small>
      </span>
      <textarea
        rows={4}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(toList(e.target.value));
        }}
      />
      <small className="muted">{hint}</small>
    </label>
  );
}
