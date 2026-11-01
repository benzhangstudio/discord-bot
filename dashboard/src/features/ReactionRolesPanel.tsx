import { type ReactNode, useEffect, useState } from "react";
import {
  MAX_REACTION_ROLE_MESSAGES,
  type ButtonStyleId,
  type ReactionRoleInput,
  type ReactionRoleKind,
  type ReactionRoleMessageView,
  type ReactionRoleMode,
  buttonStyles,
  tempRoleChoices,
  reactionRoleKinds,
  reactionRoleModes,
} from "../../../src/shared/features";
import { type GuildDetails, api } from "../api";
import { EmojiInput, EmojiView } from "../components/emoji";
import { ChannelSelect, RolePicker, RoleSelect, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const kindName = (k: ReactionRoleKind) => reactionRoleKinds.find((x) => x.id === k)?.name ?? k;
const modeName = (m: ReactionRoleMode) => reactionRoleModes.find((x) => x.id === m)?.name ?? m;
const tempLabel = (minutes: number) =>
  tempRoleChoices.find((c) => c.minutes === minutes)?.label ??
  (minutes >= 1440 ? `${Math.round(minutes / 1440)} days` : minutes >= 60 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`);

/** "5 minutes ago" style text for the last time a menu was used. */
function ago(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  const units: [number, string][] = [[86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [size, name] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

const displayName = (m: Pick<ReactionRoleMessageView, "name" | "options">) => m.name || m.options.embed.title || "Untitled role menu";

/** Dashboard section for reaction roles: list, create, edit, duplicate and delete role menus. */
export function ReactionRolesPanel({ guild }: { guild: Guild }) {
  const [messages, setMessages] = useState<ReactionRoleMessageView[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ initial?: ReactionRoleMessageView; copy?: boolean } | null>(null);
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);

  useEffect(() => {
    api.reactionRoles(guild.id).then(setMessages).catch((err) => setError(err.message));
  }, [guild.id]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [editing]);

  const roleOf = (id: string) => guild.roles.find((r) => r.id === id);
  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted-channel";

  const remove = async (m: ReactionRoleMessageView) => {
    const what = m.external
      ? "The message stays in Discord; I'll just take my reactions off it."
      : "The message is removed from Discord.";
    if (!confirm(`Delete "${displayName(m)}"? ${what} Members keep roles they already have.`)) return;
    try {
      await api.deleteReactionRole(guild.id, m.messageId);
      setMessages((list) => list?.filter((x) => x.messageId !== m.messageId) ?? null);
      setNotice({ text: `Deleted "${displayName(m)}".`, warnings: [] });
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const onSaved = (saved: ReactionRoleMessageView, warnings: string[], replacedId?: string) => {
    setMessages((list) => {
      const rest = (list ?? []).filter((x) => x.messageId !== saved.messageId && x.messageId !== replacedId);
      const index = (list ?? []).findIndex((x) => x.messageId === (replacedId ?? saved.messageId));
      if (index === -1) return [...rest, saved];
      rest.splice(index, 0, saved);
      return rest;
    });
    setEditing(null);
    setNotice({
      text: replacedId ? `Saved "${displayName(saved)}".` : `Posted "${displayName(saved)}" in #${channelName(saved.channelId)}.`,
      warnings,
    });
  };

  if (error) return <p className="error">{error}</p>;
  if (!messages) return <p className="muted panel">Loading reaction roles…</p>;

  const full = messages.length >= MAX_REACTION_ROLE_MESSAGES;

  if (editing) {
    return (
      <div className="panel">
        <Editor
          guild={guild}
          initial={editing.initial}
          copy={editing.copy}
          onCancel={() => setEditing(null)}
          onSaved={onSaved}
        />
      </div>
    );
  }

  return (
    <div className="panel">
      {notice && (
        <div className="notice">
          <span>{notice.text}</span>
          {notice.warnings.map((w) => (
            <div key={w} className="warning">⚠️ {w}</div>
          ))}
          <button className="link small" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {messages.length === 0 && (
        <p className="muted">No role menus yet. Create one to let members pick their own roles with reactions, buttons or a dropdown.</p>
      )}
      {messages.map((m) => (
        <div key={m.messageId} className="rr-message">
          <div className="rr-head">
            <div>
              <div className="rr-title">{displayName(m)}</div>
              <div className="muted small rr-meta">
                <span>#{channelName(m.channelId)}</span>
                <span className="pill tiny">{kindName(m.kind)}</span>
                {m.mode !== "normal" && <span className="pill tiny">{modeName(m.mode)}</span>}
                {m.options.maxRoles > 0 && <span className="pill tiny">Max {m.options.maxRoles}</span>}
                {(m.options.allowedRoles.length > 0 || m.options.ignoredRoles.length > 0) && <span className="pill tiny">Restricted</span>}
                {m.options.tempMinutes > 0 && <span className="pill tiny">⏳ {tempLabel(m.options.tempMinutes)}</span>}
                {m.external && <span className="pill tiny">Existing message</span>}
              </div>
              <div className="muted small rr-stats">
                {m.stats.picks || m.stats.removals ? (
                  <>
                    {m.stats.picks.toLocaleString()} role{m.stats.picks === 1 ? "" : "s"} given · {m.stats.removals.toLocaleString()} removed
                    {m.stats.lastUsedAt && <> · last used {ago(m.stats.lastUsedAt)}</>}
                    {m.stats.activeTemporary > 0 && <> · {m.stats.activeTemporary} temporary role{m.stats.activeTemporary === 1 ? "" : "s"} running</>}
                  </>
                ) : (
                  "Not used yet"
                )}
              </div>
            </div>
            <div className="rr-actions">
              <button className="btn ghost small" onClick={() => { setNotice(null); setEditing({ initial: m }); }}>Edit</button>
              {!full && (
                <button className="btn ghost small" onClick={() => { setNotice(null); setEditing({ initial: m, copy: true }); }}>Duplicate</button>
              )}
              <a className="btn ghost small" href={m.url} target="_blank" rel="noreferrer">Open in Discord</a>
              <button className="btn danger small" onClick={() => remove(m)}>Delete</button>
            </div>
          </div>
          {m.problems.length > 0 && (
            <div className="rr-problems">
              {m.problems.map((p) => (
                <div key={p} className="warning">⚠️ {p}</div>
              ))}
            </div>
          )}
          <div className="rr-entries">
            {m.entries.map((e) => {
              const role = roleOf(e.roleId);
              const color = role && role.color !== "#000000" ? role.color : undefined;
              return (
                <span key={e.emojiKey} className="rr-entry">
                  {e.emojiDisplay && <EmojiView display={e.emojiDisplay} url={e.emojiUrl} />}
                  <span className="role-chip" style={color ? { color } : undefined}>@{role?.name ?? "deleted role"}</span>
                  {(m.stats.roles[e.roleId]?.added ?? 0) > 0 && (
                    <span className="rr-count" title="Times this role was given through this menu">{m.stats.roles[e.roleId].added.toLocaleString()}</span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {full ? (
        <p className="muted small">You've reached the limit of {MAX_REACTION_ROLE_MESSAGES} role menus. Delete one to add another.</p>
      ) : (
        <button className="btn primary small" onClick={() => { setNotice(null); setEditing({}); }}>
          + New role menu
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

interface Row {
  key: number;
  emoji: string;
  roleId: string;
  label: string;
  description: string;
  style: ButtonStyleId;
}

interface Draft {
  name: string;
  channelId: string;
  kind: ReactionRoleKind;
  mode: ReactionRoleMode;
  content: string;
  embed: ReactionRoleInput["embed"];
  placeholder: string;
  maxRoles: number;
  allowedRoles: string[];
  ignoredRoles: string[];
  removeReaction: boolean;
  confirm: boolean;
  tempMinutes: number;
  /** Use a message that's already in the server (link) instead of posting one. */
  useExisting: boolean;
  existingMessage: string;
  rows: Row[];
}

let rowKey = 0;
const newRow = (r: Partial<Row> = {}): Row => ({ key: rowKey++, emoji: "", roleId: "", label: "", description: "", style: "secondary", ...r });

const defaultEmbed: ReactionRoleInput["embed"] = {
  enabled: true,
  title: "",
  description: "",
  color: "#ff4fa3",
  image: "",
  thumbnail: "",
  footer: "",
  listRoles: true,
};

function draftFrom(m: ReactionRoleMessageView | undefined, channelId: string): Draft {
  if (!m) {
    return {
      name: "",
      channelId,
      kind: "reactions",
      mode: "normal",
      content: "",
      embed: { ...defaultEmbed, title: "Pick your roles" },
      placeholder: "",
      maxRoles: 0,
      allowedRoles: [],
      ignoredRoles: [],
      removeReaction: false,
      confirm: true,
      tempMinutes: 0,
      useExisting: false,
      existingMessage: "",
      rows: [newRow()],
    };
  }
  return {
    name: m.name,
    channelId: m.channelId,
    kind: m.kind,
    mode: m.mode,
    content: m.content,
    embed: { ...defaultEmbed, ...m.options.embed },
    placeholder: m.options.placeholder,
    maxRoles: m.options.maxRoles,
    allowedRoles: m.options.allowedRoles,
    ignoredRoles: m.options.ignoredRoles,
    removeReaction: m.options.removeReaction,
    confirm: m.options.confirm,
    tempMinutes: m.options.tempMinutes,
    useExisting: m.external,
    existingMessage: m.external ? m.url : "",
    rows: m.entries.map((e) => newRow({ emoji: e.emojiDisplay, roleId: e.roleId, label: e.label, description: e.description, style: e.style })),
  };
}

/** Starting points, like MEE6's templates. Roles whose names match a row's label are picked automatically. */
const TEMPLATES: { id: string; name: string; emoji: string; make: () => Partial<Draft> }[] = [
  {
    id: "verify",
    name: "Verify",
    emoji: "✅",
    make: () => ({
      name: "Verification",
      kind: "buttons",
      mode: "verify",
      embed: { ...defaultEmbed, title: "Welcome!", description: "Read the rules, then click the button below to get access to the server.", listRoles: false },
      rows: [newRow({ emoji: "✅", label: "Verify", style: "success" })],
    }),
  },
  {
    id: "colors",
    name: "Name colours",
    emoji: "🎨",
    make: () => ({
      name: "Name colours",
      kind: "buttons",
      mode: "unique",
      embed: { ...defaultEmbed, title: "Pick a name colour", description: "Choose one colour for your name. Pick another to switch." , listRoles: false },
      rows: [
        newRow({ emoji: "🔴", label: "Red" }),
        newRow({ emoji: "🟠", label: "Orange" }),
        newRow({ emoji: "🟡", label: "Yellow" }),
        newRow({ emoji: "🟢", label: "Green" }),
        newRow({ emoji: "🔵", label: "Blue" }),
        newRow({ emoji: "🟣", label: "Purple" }),
      ],
    }),
  },
  {
    id: "pronouns",
    name: "Pronouns",
    emoji: "💬",
    make: () => ({
      name: "Pronouns",
      kind: "buttons",
      mode: "normal",
      embed: { ...defaultEmbed, title: "Your pronouns", description: "Pick any that fit. Click again to remove.", listRoles: false },
      rows: [
        newRow({ label: "he/him", style: "primary" }),
        newRow({ label: "she/her", style: "primary" }),
        newRow({ label: "they/them", style: "primary" }),
        newRow({ label: "any pronouns", style: "secondary" }),
        newRow({ label: "ask me", style: "secondary" }),
      ],
    }),
  },
  {
    id: "pings",
    name: "Notifications",
    emoji: "🔔",
    make: () => ({
      name: "Notification roles",
      kind: "reactions",
      mode: "normal",
      embed: { ...defaultEmbed, title: "Get notified", description: "React to get pinged for the things you care about." },
      rows: [
        newRow({ emoji: "📢", label: "Announcements" }),
        newRow({ emoji: "🎉", label: "Events" }),
        newRow({ emoji: "🎁", label: "Giveaways" }),
      ],
    }),
  },
  {
    id: "games",
    name: "Games",
    emoji: "🎮",
    make: () => ({
      name: "Game roles",
      kind: "dropdown",
      mode: "normal",
      placeholder: "Choose the games you play",
      embed: { ...defaultEmbed, title: "What do you play?", description: "Pick your games from the menu to find people to play with.", listRoles: false },
      rows: [
        newRow({ emoji: "⛏️", label: "Minecraft" }),
        newRow({ emoji: "🔫", label: "Valorant" }),
        newRow({ emoji: "🚀", label: "Rocket League" }),
        newRow({ emoji: "🏝️", label: "Fortnite" }),
      ],
    }),
  },
  {
    id: "regions",
    name: "Region",
    emoji: "🌍",
    make: () => ({
      name: "Regions",
      kind: "dropdown",
      mode: "unique",
      placeholder: "Where are you from?",
      embed: { ...defaultEmbed, title: "Where are you from?", description: "Pick your region.", listRoles: false },
      rows: [
        newRow({ emoji: "🌎", label: "North America" }),
        newRow({ emoji: "🌎", label: "South America" }),
        newRow({ emoji: "🌍", label: "Europe" }),
        newRow({ emoji: "🌍", label: "Africa" }),
        newRow({ emoji: "🌏", label: "Asia" }),
        newRow({ emoji: "🌏", label: "Oceania" }),
      ],
    }),
  },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rr-section">
      <h4>{title}</h4>
      {hint && <p className="muted small rr-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Editor({
  guild,
  initial,
  copy,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  initial?: ReactionRoleMessageView;
  copy?: boolean;
  onCancel: () => void;
  onSaved: (saved: ReactionRoleMessageView, warnings: string[], replacedId?: string) => void;
}) {
  const firstChannel = guild.channels.find((c) => c.type === 0 || c.type === 5)?.id ?? "";
  const [d, setD] = useState<Draft>(() => {
    const base = draftFrom(initial, firstChannel);
    // A copy of a menu on an existing message needs a different message, so the link starts empty.
    return copy ? { ...base, name: `${base.name || base.embed.title || "Role menu"} (copy)`, existingMessage: "" } : base;
  });
  const [template, setTemplate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editingExisting = initial && !copy;
  /** The menu sits on someone else's message: only emoji reactions, and the message text isn't ours to change. */
  const onExisting = d.useExisting;
  const lockedToMessage = Boolean(editingExisting && initial.external);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((x) => ({ ...x, [key]: value }));
  const setEmbed = (patch: Partial<Draft["embed"]>) => setD((x) => ({ ...x, embed: { ...x.embed, ...patch } }));
  const setRow = (key: number, patch: Partial<Row>) => setD((x) => ({ ...x, rows: x.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const moveRow = (index: number, by: number) =>
    setD((x) => {
      const rows = [...x.rows];
      const [row] = rows.splice(index, 1);
      rows.splice(Math.max(0, Math.min(rows.length, index + by)), 0, row);
      return { ...x, rows };
    });

  const kind = reactionRoleKinds.find((k) => k.id === d.kind)!;
  const modes = reactionRoleModes.filter((m) => (m.kinds as readonly string[]).includes(d.kind));

  const setKind = (k: ReactionRoleKind) =>
    setD((x) => ({
      ...x,
      kind: k,
      // Keep the mode if it still fits, otherwise fall back to Normal.
      mode: reactionRoleModes.find((m) => m.id === x.mode)!.kinds.some((kk) => kk === k) ? x.mode : "normal",
    }));

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    setTemplate(id);
    if (!t) return;
    const made = t.make();
    // Pick existing roles whose names match the template's labels.
    const rows = (made.rows ?? []).map((r) => {
      const match = guild.roles.find((role) => role.assignable && role.name.toLowerCase() === r.label.toLowerCase());
      return match ? { ...r, roleId: match.id, label: "" } : r;
    });
    setD((x) => ({ ...x, ...made, kind: x.useExisting ? "reactions" : (made.kind ?? x.kind), rows, embed: { ...x.embed, ...made.embed } }));
  };

  const submit = async () => {
    setError("");
    const rows = d.rows.filter((r) => r.emoji || r.roleId || r.label);
    if (onExisting && !lockedToMessage && !d.existingMessage.trim()) return setError("Paste the link to the message to use.");
    if (!onExisting && !d.channelId) return setError("Pick a channel.");
    if (rows.length === 0) return setError("Add at least one role.");
    const missingRole = rows.findIndex((r) => !r.roleId);
    if (missingRole !== -1) return setError(`Row ${missingRole + 1}: pick a role.`);
    if (d.kind === "reactions") {
      const missingEmoji = rows.findIndex((r) => !r.emoji);
      if (missingEmoji !== -1) return setError(`Row ${missingEmoji + 1}: pick an emoji. Reactions need one.`);
    }
    if (rows.length > kind.max) return setError(`${kind.name} can have at most ${kind.max} roles.`);

    const input: ReactionRoleInput = {
      name: d.name.trim(),
      channelId: d.channelId,
      kind: d.kind,
      mode: d.mode,
      content: d.content,
      embed: d.embed,
      placeholder: d.placeholder,
      maxRoles: d.maxRoles,
      allowedRoles: d.allowedRoles,
      ignoredRoles: d.ignoredRoles,
      removeReaction: d.removeReaction,
      confirm: d.confirm,
      tempMinutes: d.mode === "drop" ? 0 : d.tempMinutes,
      existingMessage: onExisting && !lockedToMessage ? d.existingMessage.trim() : "",
      entries: rows.map(({ emoji, roleId, label, description, style }) => ({ emoji, roleId, label, description, style })),
    };
    setSaving(true);
    try {
      const result = editingExisting
        ? await api.updateReactionRole(guild.id, initial.messageId, input)
        : await api.createReactionRole(guild.id, input);
      onSaved(result.message, result.warnings, editingExisting ? initial.messageId : undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rr-editor">
      <div className="rr-editor-head">
        <button className="link small" onClick={onCancel}>← All role menus</button>
        <h3>{editingExisting ? `Edit ${displayName({ name: initial.name, options: initial.options })}` : copy ? "Duplicate role menu" : "New role menu"}</h3>
      </div>

      <div className="rr-editor-grid">
        <div className="rr-editor-form">
          {!initial && (
            <Section title="Start from a template" hint="Optional. Fills in the message and rows; you just pick the roles.">
              <div className="rr-templates">
                <button type="button" className={`rr-template ${template === null ? "on" : ""}`} onClick={() => { setTemplate(null); setD(draftFrom(undefined, d.channelId)); }}>
                  <span>✏️</span>Blank
                </button>
                {TEMPLATES.map((t) => (
                  <button key={t.id} type="button" className={`rr-template ${template === t.id ? "on" : ""}`} onClick={() => applyTemplate(t.id)}>
                    <span>{t.emoji}</span>
                    {t.name}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Basics">
            <label className="field">
              <span>Name <em className="muted">(only you see this)</em></span>
              <input value={d.name} maxLength={100} placeholder="e.g. Colour roles" onChange={(e) => set("name", e.target.value)} />
            </label>
            {!editingExisting && (
              <div className="field">
                <span>Where</span>
                <div className="rr-where" role="radiogroup" aria-label="Where the role menu goes">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!onExisting}
                    className={`rr-template ${!onExisting ? "on" : ""}`}
                    onClick={() => set("useExisting", false)}
                  >
                    <span>📝</span>Post a new message
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={onExisting}
                    className={`rr-template ${onExisting ? "on" : ""}`}
                    onClick={() => setD((x) => ({ ...x, useExisting: true, kind: "reactions" }))}
                  >
                    <span>🔗</span>Use a message that's already there
                  </button>
                </div>
              </div>
            )}
            {lockedToMessage ? (
              <div className="field">
                <span>Message</span>
                <div className="rr-existing-note">
                  This menu adds reactions to a message that's already in{" "}
                  <strong>#{guild.channels.find((c) => c.id === initial?.channelId)?.name ?? "a channel"}</strong>.{" "}
                  <a href={initial?.url} target="_blank" rel="noreferrer">Open it in Discord</a>
                </div>
              </div>
            ) : onExisting ? (
              <label className="field">
                <span>Message link</span>
                <input
                  value={d.existingMessage}
                  placeholder="https://discord.com/channels/…"
                  onChange={(e) => set("existingMessage", e.target.value)}
                />
                <small className="muted">
                  In Discord, right-click the message (or long-press on a phone) → Copy Message Link, then paste it here. I'll add the
                  reactions without changing the message.
                </small>
              </label>
            ) : (
              <div className="field">
                <span>Channel</span>
                <ChannelSelect guild={guild} value={d.channelId || null} onChange={(id) => set("channelId", id ?? "")} />
                {editingExisting && d.channelId !== initial.channelId && (
                  <small className="muted">The message will be reposted in the new channel. Members keep their roles.</small>
                )}
              </div>
            )}
          </Section>

          <Section
            title="How members pick"
            hint={onExisting ? "Buttons and menus can only go on messages I post, so existing messages use emoji reactions." : undefined}
          >
            <div className="rr-kinds">
              {reactionRoleKinds.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className={`rr-kind ${d.kind === k.id ? "on" : ""}`}
                  aria-pressed={d.kind === k.id}
                  disabled={onExisting && k.id !== "reactions"}
                  onClick={() => setKind(k.id)}
                >
                  <strong>{k.name}</strong>
                  <small className="muted">{k.description}</small>
                </button>
              ))}
            </div>
          </Section>

          <Section
            title="Roles"
            hint={
              d.kind === "reactions"
                ? "Each emoji gives one role."
                : d.kind === "buttons"
                  ? "Each button gives one role. Leave the text empty to use the role's name."
                  : "Each option gives one role. Leave the name empty to use the role's name."
            }
          >
            {d.rows.map((r, i) => (
              <div key={r.key} className={`rr-row-card kind-${d.kind}`}>
                <div className="rr-row-main">
                  <EmojiInput guild={guild} value={r.emoji} onChange={(emoji) => setRow(r.key, { emoji })} />
                  <RoleSelect guild={guild} value={r.roleId || null} onChange={(id) => setRow(r.key, { roleId: id ?? "" })} />
                  <div className="rr-row-tools">
                    <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => moveRow(i, -1)}>↑</button>
                    <button className="icon-btn" aria-label="Move down" disabled={i === d.rows.length - 1} onClick={() => moveRow(i, 1)}>↓</button>
                    <button
                      className="icon-btn"
                      aria-label="Remove row"
                      onClick={() => set("rows", d.rows.length > 1 ? d.rows.filter((x) => x.key !== r.key) : [newRow()])}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {d.kind !== "reactions" && (
                  <div className="rr-row-extra">
                    <input
                      value={r.label}
                      maxLength={80}
                      placeholder={d.kind === "buttons" ? "Button text (optional)" : "Option name (optional)"}
                      onChange={(e) => setRow(r.key, { label: e.target.value })}
                    />
                    {d.kind === "buttons" ? (
                      <div className="rr-styles" role="radiogroup" aria-label="Button colour">
                        {buttonStyles.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            role="radio"
                            aria-checked={r.style === s.id}
                            title={s.name}
                            className={`rr-style ${r.style === s.id ? "on" : ""}`}
                            style={{ background: s.color }}
                            onClick={() => setRow(r.key, { style: s.id })}
                          />
                        ))}
                      </div>
                    ) : (
                      <input
                        value={r.description}
                        maxLength={100}
                        placeholder="Description (optional)"
                        onChange={(e) => setRow(r.key, { description: e.target.value })}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
            {d.rows.length < kind.max ? (
              <button className="link small add-row" onClick={() => set("rows", [...d.rows, newRow()])}>+ Add another role</button>
            ) : (
              <small className="muted">{kind.name} can have up to {kind.max} roles.</small>
            )}
            <small className="muted">Roles marked "above my role" can't be given out until my role is moved higher in Server Settings → Roles.</small>
          </Section>

          {!onExisting && (
          <Section title="Message">
            <label className="field">
              <span>Text <em className="muted">(optional, shown above the embed)</em></span>
              <textarea value={d.content} maxLength={2000} rows={2} placeholder="Plain message text" onChange={(e) => set("content", e.target.value)} />
            </label>
            <Toggle checked={d.embed.enabled} onChange={(v) => setEmbed({ enabled: v })} label="Embed" hint="A card with a coloured bar, title and description." />
            {d.embed.enabled && (
              <div className="rr-embed-fields">
                <div className="rr-two">
                  <label className="field">
                    <span>Title</span>
                    <input value={d.embed.title} maxLength={256} placeholder="Pick your roles" onChange={(e) => setEmbed({ title: e.target.value })} />
                  </label>
                  <label className="field rr-color">
                    <span>Colour</span>
                    <input type="color" value={d.embed.color} onChange={(e) => setEmbed({ color: e.target.value })} />
                  </label>
                </div>
                <label className="field">
                  <span>Description</span>
                  <textarea
                    value={d.embed.description}
                    maxLength={4000}
                    rows={3}
                    placeholder="Tell members what these roles are for."
                    onChange={(e) => setEmbed({ description: e.target.value })}
                  />
                </label>
                <Toggle checked={d.embed.listRoles} onChange={(v) => setEmbed({ listRoles: v })} label="List the roles in the embed" hint="Adds a line for each role, like “🎮 @Gamer”." />
                <div className="rr-two">
                  <label className="field">
                    <span>Image link <em className="muted">(optional)</em></span>
                    <input value={d.embed.image} placeholder="https://…" onChange={(e) => setEmbed({ image: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Thumbnail link <em className="muted">(optional)</em></span>
                    <input value={d.embed.thumbnail} placeholder="https://…" onChange={(e) => setEmbed({ thumbnail: e.target.value })} />
                  </label>
                </div>
                <label className="field">
                  <span>Footer <em className="muted">(empty = a short how-to)</em></span>
                  <input value={d.embed.footer} maxLength={2048} placeholder="React to get a role…" onChange={(e) => setEmbed({ footer: e.target.value })} />
                </label>
              </div>
            )}
          </Section>
          )}

          <Section title="Mode">
            <div className="rr-modes">
              {modes.map((m) => (
                <label key={m.id} className={`rr-mode ${d.mode === m.id ? "on" : ""}`}>
                  <input type="radio" name="rr-mode" checked={d.mode === m.id} onChange={() => set("mode", m.id)} />
                  <span>
                    <strong>{m.name}</strong>
                    <small className="muted">{m.description}</small>
                  </span>
                </label>
              ))}
            </div>
            {(d.mode === "normal" || d.mode === "binding") && (
              <label className="field rr-max">
                <span>{d.mode === "binding" ? "How many roles can members pick?" : "Most roles a member can have from this message"}</span>
                <select value={d.maxRoles} onChange={(e) => set("maxRoles", Number(e.target.value))}>
                  <option value={0}>{d.mode === "binding" ? "1" : "No limit"}</option>
                  {Array.from({ length: Math.max(0, Math.min(d.rows.length, 25) - 1) }, (_, i) => i + (d.mode === "binding" ? 2 : 1)).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
            {d.mode !== "drop" && (
              <label className="field rr-max">
                <span>Roles last</span>
                <select value={d.tempMinutes} onChange={(e) => set("tempMinutes", Number(e.target.value))}>
                  {tempRoleChoices.map((c) => (
                    <option key={c.minutes} value={c.minutes}>{c.label}</option>
                  ))}
                  {!tempRoleChoices.some((c) => c.minutes === d.tempMinutes) && <option value={d.tempMinutes}>{tempLabel(d.tempMinutes)}</option>}
                </select>
                <small className="muted">
                  {d.tempMinutes
                    ? `Roles from this menu are taken away ${tempLabel(d.tempMinutes)} after they're picked. Picking again restarts the time.`
                    : "Members keep their roles until they remove them."}
                </small>
              </label>
            )}
            {d.kind === "dropdown" && (
              <label className="field">
                <span>Menu placeholder</span>
                <input value={d.placeholder} maxLength={150} placeholder="Choose your roles" onChange={(e) => set("placeholder", e.target.value)} />
              </label>
            )}
            {d.kind === "reactions" ? (
              <Toggle
                checked={d.removeReaction}
                onChange={(v) => set("removeReaction", v)}
                label="Remove reactions after use"
                hint="Keeps the counts clean. Reacting again toggles the role. Needs Manage Messages."
              />
            ) : (
              <Toggle
                checked={d.confirm}
                onChange={(v) => set("confirm", v)}
                label="Tell members what changed"
                hint="A private message only they can see, like “Added @Gamer”."
              />
            )}
          </Section>

          <Section title="Who can use it" hint="Optional. Leave both empty to let everyone use this message.">
            <div className="field">
              <span>Members need one of these roles</span>
              <RolePicker guild={guild} anyRole value={d.allowedRoles} onChange={(v) => set("allowedRoles", v)} max={25} placeholder="Add a required role…" />
            </div>
            <div className="field">
              <span>Members with any of these roles can't use it</span>
              <RolePicker guild={guild} anyRole value={d.ignoredRoles} onChange={(v) => set("ignoredRoles", v)} max={25} placeholder="Add a blocked role…" />
            </div>
          </Section>

          {error && <p className="error">{error}</p>}
          <div className="editor-actions rr-save">
            <button className="btn primary" disabled={saving} onClick={submit}>
              {saving ? "Saving…" : editingExisting ? "Save changes" : onExisting ? "Add reactions" : "Post message"}
            </button>
            <button className="btn ghost" disabled={saving} onClick={onCancel}>Cancel</button>
          </div>
        </div>

        <aside className="rr-preview-wrap">
          <div className="muted small rr-preview-label">Preview</div>
          <Preview guild={guild} d={d} />
        </aside>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- preview */

const STYLE_COLORS: Record<string, string> = Object.fromEntries(buttonStyles.map((s) => [s.id, s.color]));

/** A Discord-like preview of the message, updated as the admin types. */
function Preview({ guild, d }: { guild: Guild; d: Draft }) {
  const roleName = (id: string) => guild.roles.find((r) => r.id === id)?.name;
  const rows = d.rows.filter((r) => r.emoji || r.roleId || r.label);
  const labelOf = (r: Row) => r.label || roleName(r.roleId) || "Role";

  const mention = (id: string) => {
    const role = guild.roles.find((r) => r.id === id);
    const color = role && role.color !== "#000000" ? role.color : undefined;
    return (
      <span className="dc-mention" style={color ? { color, background: `${color}26` } : undefined}>
        @{role?.name ?? "role"}
      </span>
    );
  };

  // Renders <@&id> role mentions in text as Discord-style pills.
  const rich = (text: string) =>
    text.split(/(<@&\d{17,20}>)/g).map((part, i) => {
      const m = part.match(/^<@&(\d+)>$/);
      return m ? <span key={i}>{mention(m[1])}</span> : <span key={i}>{part}</span>;
    });

  const unique = d.mode === "unique";
  const footer =
    d.embed.footer ||
    (unique ? "Pick one. Choosing another swaps it." : d.kind === "reactions" ? "React to get a role." : d.kind === "buttons" ? "Click a button to get a role." : "Pick roles from the menu.");

  return (
    <div className="dc-message">
      <div className="dc-avatar">1</div>
      <div className="dc-body">
        <div className="dc-author">
          Number One <span className="dc-bot">APP</span>
        </div>
        {d.useExisting && <div className="dc-content muted">Your existing message stays exactly as it is. I only add the reactions below.</div>}
        {!d.useExisting && d.content.trim() && <div className="dc-content">{rich(d.content)}</div>}
        {!d.useExisting && d.embed.enabled && (
          <div className="dc-embed" style={{ borderLeftColor: d.embed.color }}>
            <div className="dc-embed-main">
              <div>
                {d.embed.title && <div className="dc-embed-title">{d.embed.title}</div>}
                {d.embed.description.trim() && <div className="dc-embed-desc">{rich(d.embed.description)}</div>}
                {d.embed.listRoles && rows.length > 0 && (
                  <div className="dc-embed-desc dc-lines">
                    {rows.map((r) => (
                      <div key={r.key}>
                        {r.emoji && <EmojiView display={r.emoji} />} {r.roleId ? mention(r.roleId) : <span className="muted">@role</span>}
                        {d.kind === "dropdown" && r.description && <span className="muted"> — {r.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/^https:\/\//.test(d.embed.thumbnail) && <img className="dc-thumb" src={d.embed.thumbnail} alt="" />}
            </div>
            {/^https:\/\//.test(d.embed.image) && <img className="dc-image" src={d.embed.image} alt="" />}
            <div className="dc-footer">{footer}</div>
          </div>
        )}
        {!d.useExisting && !d.content.trim() && !d.embed.enabled && <div className="muted small">Write some text or turn on the embed.</div>}

        {d.kind === "reactions" && rows.length > 0 && (
          <div className="dc-reactions">
            {rows.map((r) => (
              <span key={r.key} className="dc-reaction">
                {r.emoji ? <EmojiView display={r.emoji} /> : "❔"} 1
              </span>
            ))}
          </div>
        )}
        {d.kind === "buttons" && (
          <div className="dc-buttons">
            {rows.slice(0, 25).map((r) => (
              <span key={r.key} className="dc-button" style={{ background: STYLE_COLORS[r.style] }}>
                {r.emoji && <EmojiView display={r.emoji} />}
                {(r.label || !r.emoji) && <span>{labelOf(r)}</span>}
              </span>
            ))}
          </div>
        )}
        {d.kind === "dropdown" && (
          <div className="dc-select">
            <div className="dc-select-box">
              <span className="muted">{d.placeholder || (unique ? "Choose a role" : "Choose your roles")}</span>
              <span className="muted">▾</span>
            </div>
            <div className="dc-select-list">
              {rows.slice(0, 5).map((r) => (
                <div key={r.key} className="dc-option">
                  {r.emoji && <EmojiView display={r.emoji} />}
                  <span>
                    <span>{labelOf(r)}</span>
                    {r.description && <small className="muted">{r.description}</small>}
                  </span>
                </div>
              ))}
              {rows.length > 5 && <div className="muted small dc-more">+{rows.length - 5} more</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
