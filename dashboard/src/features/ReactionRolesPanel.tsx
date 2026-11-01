import { useEffect, useState } from "react";
import type { ReactionRoleMessageView } from "../../../src/shared/features";
import { type GuildDetails, api } from "../api";

/** Dashboard section for reaction roles: shows each message and its emoji → role pairs. */
export function ReactionRolesPanel({ guild }: { guild: GuildDetails["guild"] }) {
  const [messages, setMessages] = useState<ReactionRoleMessageView[] | null>(null);
  const [error, setError] = useState("");

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
    } catch (err) {
      alert((err as Error).message);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!messages) return <p className="muted">Loading reaction roles…</p>;

  return (
    <div className="panel">
      {messages.length === 0 ? (
        <p className="muted">
          No reaction-role messages yet. In Discord, use <code>/reactionroles create</code> to post one, then{" "}
          <code>/reactionroles add</code> to attach emojis and roles.
        </p>
      ) : (
        messages.map((m) => (
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
                <a className="btn ghost small" href={m.url} target="_blank" rel="noreferrer">
                  Open in Discord
                </a>
                <button className="btn danger small" onClick={() => remove(m)}>
                  Delete
                </button>
              </div>
            </div>
            {m.entries.length === 0 ? (
              <p className="muted small">No roles yet. Add one with <code>/reactionroles add</code>.</p>
            ) : (
              <div className="rr-entries">
                {m.entries.map((e) => {
                  const role = roleOf(e.roleId);
                  const color = role && role.color !== "#000000" ? role.color : undefined;
                  return (
                    <span key={e.emojiKey} className="rr-entry">
                      {e.emojiUrl ? <img src={e.emojiUrl} alt="" width={20} height={20} /> : <span className="rr-emoji">{e.emojiDisplay}</span>}
                      <span className="role-chip" style={color ? { color, borderColor: color } : undefined}>
                        @{role?.name ?? "deleted role"}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))
      )}
      <p className="muted small hint">
        Manage messages in Discord with <code>/reactionroles</code>: create, add, remove, edit, list and delete.
      </p>
    </div>
  );
}
