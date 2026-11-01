import { useEffect, useState } from "react";
import { MAX_REACTION_ROLE_MESSAGES, type ReactionRoleInput, type ReactionRoleMessageView } from "../../../src/shared/features";
import { type GuildDetails, api } from "../api";
import { EmojiInput, EmojiView } from "../components/emoji";
import { ChannelSelect, RoleSelect } from "../components/pickers";

type Guild = GuildDetails["guild"];

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
              {m.problems.length > 0 && (
                <div className="rr-problems">
                  {m.problems.map((p) => (
                    <div key={p} className="warning">⚠️ {p}</div>
                  ))}
                </div>
              )}
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
          {messages.length < MAX_REACTION_ROLE_MESSAGES ? (
            <button className="btn primary small" onClick={() => { setNotice(null); setEditing("new"); }}>
              + New reaction-role message
            </button>
          ) : (
            <p className="muted small">You've reached the limit of {MAX_REACTION_ROLE_MESSAGES} reaction-role messages. Delete one to add another.</p>
          )}
        </>
      )}
    </div>
  );
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
    if (!input.channelId) return setError("Pick a channel.");
    if (filled.length === 0) return setError("Add at least one emoji and role.");
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

      <div className="field">
        <span>Channel</span>
        <ChannelSelect guild={guild} value={channelId || null} onChange={(id) => setChannelId(id ?? "")} />
        {initial && channelId !== initial.channelId && (
          <small className="muted">The message will be reposted in the new channel. Members keep their roles.</small>
        )}
      </div>

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
            <RoleSelect guild={guild} value={r.roleId || null} onChange={(id) => update(r.key, { roleId: id ?? "" })} />
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
