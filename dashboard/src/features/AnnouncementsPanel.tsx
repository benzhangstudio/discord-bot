import { useEffect, useState } from "react";
import { type AnnouncementSettings, type AnnouncementsPanelData, announcementTypes } from "../../../src/shared/announcements";
import { type GuildDetails, api } from "../api";
import { ChannelSelect, RolePicker, Toggle } from "../components/pickers";

type Guild = GuildDetails["guild"];

const typeOf = (id: string) => announcementTypes.find((t) => t.id === id);

/** Dashboard section for Bot announcements: where messages from Number One's developer go. */
export function AnnouncementsPanel({ guild }: { guild: Guild }) {
  const [data, setData] = useState<AnnouncementsPanelData | null>(null);
  const [draft, setDraft] = useState<AnnouncementSettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);

  const load = (d: AnnouncementsPanelData) => {
    setData(d);
    setDraft({ ...d.settings });
  };

  useEffect(() => {
    api.announcements(guild.id).then(load).catch((err) => setError(err.message));
  }, [guild.id]);

  if (error && !data) return <p className="error panel">{error}</p>;
  if (!data || !draft) return <p className="muted panel">Loading announcements…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const set = (patch: Partial<AnnouncementSettings>) => setDraft((d) => ({ ...d!, ...patch }));

  const save = async () => {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      load(await api.saveAnnouncements(guild.id, draft));
      setNotice("Saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      await api.testAnnouncement(guild.id);
      setNotice("Test sent. Check the channel.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel ann">
      <p className="muted small ann-intro">
        Number One's developer uses this to tell you about updates, planned maintenance, downtime and security issues, so
        nobody has to message every server owner. Choose where they should appear.
      </p>

      {data.warnings.map((w) => (
        <div key={w} className="notice warning-box">⚠️ {w}</div>
      ))}

      <section className="ann-sub">
        <div className="sub-head">
          <strong>Where to post</strong>
          <small className="muted">Pick a channel, and a role to ping for urgent notices.</small>
        </div>
        <label className="field">
          <span>Channel</span>
          <ChannelSelect
            guild={guild}
            value={draft.channelId}
            emptyLabel="No channel (urgent notices only)"
            onChange={(v) => set({ channelId: v })}
          />
          <small className="muted">
            Without a channel you only get urgent notices (security, maintenance, downtime), in your server's system channel or
            as a message to the server owner.
          </small>
        </label>

        <div className="field">
          <span>Role to ping</span>
          <RolePicker guild={guild} value={draft.roleId ? [draft.roleId] : []} max={1} anyRole placeholder="Add a role…" onChange={(ids) => set({ roleId: ids[0] ?? null })} />
          <small className="muted">Pinged only for security, maintenance and online/offline notices. Updates and news never ping.</small>
        </div>
      </section>

      <section className="ann-sub">
        <div className="sub-head">
          <strong>What to receive</strong>
          <small className="muted">Switch off kinds you don't want in your channel.</small>
        </div>
        {announcementTypes.map((t) =>
          t.optional ? (
            <Toggle
              key={t.id}
              label={`${t.emoji} ${t.name}`}
              hint={t.description}
              checked={draft[t.id]}
              onChange={(v) => set({ [t.id]: v } as Partial<AnnouncementSettings>)}
            />
          ) : (
            <div key={t.id} className="ann-locked">
              <span>
                <strong>{t.emoji} {t.name}</strong>
                <small className="muted">{t.description}. To stop everything, switch the whole feature off.</small>
              </span>
              <span className="pill tiny">Always on</span>
            </div>
          ),
        )}
      </section>

      <div className="editor-actions">
        <button className="btn primary" disabled={!dirty || busy !== null} onClick={save}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button className="btn ghost" disabled={dirty || !data.settings.channelId || busy !== null} onClick={test} title={dirty ? "Save first" : undefined}>
          {busy === "test" ? "Sending…" : "Send a test"}
        </button>
        {error && <span className="error small">{error}</span>}
        {notice && <span className="muted small">{notice}</span>}
      </div>

      <section className="ann-sub ann-recent">
        <div className="sub-head">
          <strong>Recent announcements</strong>
          <small className="muted">The last things Number One's developer told this server.</small>
        </div>
        {data.recent.length === 0 && <p className="muted small">Nothing yet.</p>}
        {data.recent.map((a) => {
          const t = typeOf(a.type);
          return (
            <article key={a.id} className="ann-item">
              <div className="ann-item-head">
                <strong>{t?.emoji} {a.title}</strong>
                <span className="muted small">{new Date(a.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>
              <p className="muted small ann-body">{a.body}</p>
              {a.url && <a className="small" href={a.url} target="_blank" rel="noreferrer">Learn more</a>}
            </article>
          );
        })}
      </section>
    </div>
  );
}
