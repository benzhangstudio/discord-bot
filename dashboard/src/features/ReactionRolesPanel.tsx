import { useEffect, useRef, useState } from "react";
import type { ReactionRoleInput, ReactionRoleMessageView } from "../../../src/shared/features";
import { type GuildDetails, api } from "../api";

type Guild = GuildDetails["guild"];

const COMMON_EMOJIS = [
  "✅", "❌", "⭐", "🔥", "💖", "💜", "💙", "💚", "💛", "🧡", "🖤", "🤍",
  "🎮", "🎨", "🎵", "🎧", "📚", "💻", "🏀", "⚽", "🎬", "📸", "✈️", "🍕",
  "🔔", "📢", "🎉", "🎁", "👋", "🌙", "☀️", "🌸", "🐱", "🐶", "1️⃣", "2️⃣",
  "3️⃣", "4️⃣", "5️⃣", "🇺🇸", "🇬🇧", "🇪🇸", "🇫🇷", "🇩🇪", "🇯🇵", "🇰🇷", "🇧🇷", "🇮🇳",
];

const TEXT_CHANNEL_TYPES = new Set([0, 5]); // text and announcement channels

/** Dashboard section for reaction roles: list, create, edit and delete reaction-role messages. */
export function ReactionRolesPanel({ guild }: { guild: Guild }) {
  const [messages, setMessages] = useState<ReactionRoleMessageView[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ReactionRoleMessageView | "new" | null>(null);
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);

  useEffect(() => {
    api.reactionRoles(guild.id).then(setMessages).catch((err) => setError(err.message));
  }, [guild.id]);

  const roleOf = (id: string) => guild.roles.find((r) => r.id === id);
  const channelName = (id: string) => guild.channels.find((c) => c.id === id)?.name ?? "deleted-channel";

  const remove = async (m: ReactionRoleMessageView) => {
    if (!confirm(`Delete "${m.title}"? The message is removed from Discord. Members keep roles they already have.`)) return;
    try {
      await api.deleteReactionRole(guild.id, m.messageId);
      setMessages((list) => list?.filter((x) => x.messageId !== m.messageId) ?? null);
      setNotice({ text: `Deleted "${m.title}".`, warnings: [] });
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
    setNotice({ text: replacedId ? `Saved "${saved.title}".` : `Posted "${saved.title}" in #${channelName(saved.channelId)}.`, warnings });
  };

  if (error) return <p className="error">{error}</p>;
  if (!messages) return <p className="muted panel">Loading reaction roles…</p>;

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

      {editing && (
        <Editor
          guild={guild}
          initial={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {!editing && (
        <>
          {messages.length === 0 && <p className="muted">No reaction-role messages yet. Create one to let members pick roles.</p>}
          {messages.map((m) => (
            <div key={m.messageId} className="rr-message">
              <div className="rr-head">
                <div>
                  <div className="rr-title">{m.title}</div>
                  <div className="muted small">
                    #{channelName(m.channelId)}
                    {m.singleChoice && <span className="pill tiny">Single choice</span>}
                  </div>
                </div>
                <div className="rr-actions">
                  <button className="btn ghost small" onClick={() => setEditing(m)}>Edit</button>
                  <a className="btn ghost small" href={m.url} target="_blank" rel="noreferrer">Open in Discord</a>
                  <button className="btn danger small" onClick={() => remove(m)}>Delete</button>
                </div>
              </div>
              {m.entries.length === 0 ? (
                <p className="muted small">No roles yet. Click Edit to add some.</p>
              ) : (
                <div className="rr-entries">
                  {m.entries.map((e) => {
                    const role = roleOf(e.roleId);
                    const color = role && role.color !== "#000000" ? role.color : undefined;
                    return (
                      <span key={e.emojiKey} className="rr-entry">
                        <EmojiView display={e.emojiDisplay} url={e.emojiUrl} />
                        <span className="role-chip" style={color ? { color } : undefined}>@{role?.name ?? "deleted role"}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <button className="btn primary small" onClick={() => { setNotice(null); setEditing("new"); }}>
            + New reaction-role message
          </button>
        </>
      )}
    </div>
  );
}

function EmojiView({ display, url }: { display: string; url?: string | null }) {
  const custom = display.match(/^<(a?):\w+:(\d+)>$/);
  const src = url ?? (custom ? `https://cdn.discordapp.com/emojis/${custom[2]}.${custom[1] ? "gif" : "png"}?size=48` : null);
  return src ? <img className="emoji-img" src={src} alt="" width={20} height={20} /> : <span className="rr-emoji">{display}</span>;
}

interface Row {
  key: number;
  emoji: string;
  roleId: string;
}

let rowKey = 0;

function Editor({
  guild,
  initial,
  onCancel,
  onSaved,
}: {
  guild: Guild;
  initial?: ReactionRoleMessageView;
  onCancel: () => void;
  onSaved: (saved: ReactionRoleMessageView, warnings: string[], replacedId?: string) => void;
}) {
  const channels = guild.channels.filter((c) => TEXT_CHANNEL_TYPES.has(c.type));
  const [channelId, setChannelId] = useState(initial?.channelId ?? channels[0]?.id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [singleChoice, setSingleChoice] = useState(initial?.singleChoice ?? false);
  const [rows, setRows] = useState<Row[]>(
    initial?.entries.length
      ? initial.entries.map((e) => ({ key: rowKey++, emoji: e.emojiDisplay, roleId: e.roleId }))
      : [{ key: rowKey++, emoji: "", roleId: "" }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    setError("");
    const filled = rows.filter((r) => r.emoji.trim() || r.roleId);
    const input: ReactionRoleInput = {
      channelId,
      title: title.trim(),
      description,
      singleChoice,
      entries: filled.map((r) => ({ emoji: r.emoji.trim(), roleId: r.roleId })),
    };
    if (!input.title) return setError("Add a title.");
    if (filled.some((r) => !r.emoji.trim() || !r.roleId)) return setError("Each row needs both an emoji and a role.");
    setSaving(true);
    try {
      const result = initial
        ? await api.updateReactionRole(guild.id, initial.messageId, input)
        : await api.createReactionRole(guild.id, input);
      onSaved(result.message, result.warnings, initial?.messageId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor">
      <h3>{initial ? "Edit reaction-role message" : "New reaction-role message"}</h3>

      <label className="field">
        <span>Channel</span>
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </select>
        {initial && channelId !== initial.channelId && (
          <small className="muted">The message will be reposted in the new channel. Members keep their roles.</small>
        )}
      </label>

      <label className="field">
        <span>Title</span>
        <input value={title} maxLength={256} placeholder="Pick your roles" onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="field">
        <span>Description <em className="muted">(optional)</em></span>
        <textarea
          value={description}
          maxLength={2000}
          rows={3}
          placeholder="React below to get a role. Remove your reaction to remove it."
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <label className="check">
        <input type="checkbox" checked={singleChoice} onChange={(e) => setSingleChoice(e.target.checked)} />
        <span>
          <strong>Single choice</strong>
          <small className="muted">Members can have only one role from this message. Picking another swaps it.</small>
        </span>
      </label>

      <div className="field">
        <span>Emojis and roles</span>
        {rows.map((r) => (
          <div key={r.key} className="rr-row">
            <EmojiInput guild={guild} value={r.emoji} onChange={(emoji) => update(r.key, { emoji })} />
            <select value={r.roleId} onChange={(e) => update(r.key, { roleId: e.target.value })}>
              <option value="">Choose a role…</option>
              {guild.roles.map((role) => (
                <option key={role.id} value={role.id} disabled={!role.assignable}>
                  @{role.name}{role.assignable ? "" : " (above my role)"}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              aria-label="Remove row"
              onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: rowKey++, emoji: "", roleId: "" }]))}
            >
              ×
            </button>
          </div>
        ))}
        {rows.length < 20 && (
          <button className="link small add-row" onClick={() => setRows((rs) => [...rs, { key: rowKey++, emoji: "", roleId: "" }])}>
            + Add another role
          </button>
        )}
        <small className="muted">
          Roles marked "above my role" can't be given out until my role is moved higher in Server Settings → Roles.
        </small>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="editor-actions">
        <button className="btn primary" disabled={saving} onClick={submit}>
          {saving ? "Saving…" : initial ? "Save changes" : "Post message"}
        </button>
        <button className="btn ghost" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Text box for an emoji, with a picker of this server's custom emojis and common ones. */
function EmojiInput({ guild, value, onChange }: { guild: Guild; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="emoji-input" ref={ref}>
      <button className="emoji-btn" type="button" aria-label="Choose emoji" onClick={() => setOpen((o) => !o)}>
        {value ? <EmojiView display={value} /> : <span className="muted">🙂</span>}
      </button>
      <input value={value} placeholder="Emoji" onChange={(e) => onChange(e.target.value)} />
      {open && (
        <div className="emoji-pop">
          {guild.emojis.length > 0 && (
            <>
              <div className="muted small">This server</div>
              <div className="emoji-grid">
                {guild.emojis.map((e) => (
                  <button key={e.id} type="button" title={`:${e.name}:`} onClick={() => pick(e.text)}>
                    <EmojiView display={e.text} />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="muted small">Common</div>
          <div className="emoji-grid">
            {COMMON_EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => pick(e)}>{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
