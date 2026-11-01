import { useEffect, useRef, useState } from "react";
import {
  type AnnouncementFailure,
  type AnnouncementSummary,
  type AnnouncementTypeId,
  type AudiencePreview,
  MAX_BODY,
  MAX_TITLE,
  announcementTypes,
} from "../../../src/shared/announcements";
import { api } from "../api";

const typeOf = (id: string) => announcementTypes.find((t) => t.id === id) ?? announcementTypes[3];

/** Starting points so a downtime notice takes seconds to send. */
const TEMPLATES: { label: string; type: AnnouncementTypeId; title: string; body: string }[] = [
  {
    label: "Going down for maintenance",
    type: "maintenance",
    title: "Scheduled maintenance",
    body: "Number One will be offline briefly for maintenance. Commands, role menus and the dashboard won't respond until it's back. We'll post here as soon as it's online again.",
  },
  {
    label: "Back online",
    type: "status",
    title: "Number One is back online",
    body: "Everything is running again. Thanks for your patience!",
  },
  {
    label: "New update",
    type: "update",
    title: "New update",
    body: "**What's new**\n• \n• \n\n**Fixed**\n• ",
  },
  {
    label: "Security notice",
    type: "security",
    title: "Security notice",
    body: "We found and fixed a security issue.\n\n**What happened:** \n**What you need to do:** nothing / …",
  },
];

const OUTCOME_LABELS: [keyof AudiencePreview["counts"], string][] = [
  ["channel", "in their chosen channel"],
  ["fallback", "urgent notice to the system channel or owner"],
  ["skipped-nochannel", "skipped, no channel set"],
  ["skipped-type", "skipped, this kind switched off"],
  ["skipped-off", "skipped, announcements switched off"],
  ["failed", "failed"],
];

/** Where the bot's developer writes an announcement and sends it to every server. */
export function DeveloperPage() {
  const [type, setType] = useState<AnnouncementTypeId>("update");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState<AudiencePreview | null>(null);
  const [list, setList] = useState<AnnouncementSummary[] | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [denied, setDenied] = useState(false);

  const loadList = () =>
    api
      .developerAnnouncements()
      .then((r) => setList(r.announcements))
      .catch((err) => {
        if (err.status === 403) setDenied(true);
        else setError(err.message);
      });

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    setAudience(null);
    api.previewAudience(type).then(setAudience).catch(() => {});
  }, [type]);

  // While an announcement is still going out, keep the progress fresh.
  const sendingNow = list?.some((a) => a.status === "sending") ?? false;
  const timer = useRef<number>(0);
  useEffect(() => {
    if (!sendingNow) return;
    timer.current = window.setInterval(loadList, 3000);
    return () => window.clearInterval(timer.current);
  }, [sendingNow]);

  if (denied) {
    return (
      <section>
        <h1>Developer</h1>
        <p className="muted">Only the bot's developer can send announcements.</p>
      </section>
    );
  }

  const info = typeOf(type);
  const ready = title.trim() && body.trim();
  const reach = audience ? audience.counts.channel + audience.counts.fallback : 0;

  const send = async () => {
    setError("");
    if (!window.confirm(`Send “${title.trim()}” to ${audience ? `about ${reach} of ${audience.servers}` : "all"} servers now? This can't be undone.`)) return;
    setSending(true);
    try {
      await api.sendAnnouncement({ type, title, body, url });
      setTitle("");
      setBody("");
      setUrl("");
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="dev">
      <div className="page-head">
        <h1>📢 Announcements</h1>
        <p className="muted">
          Write a message once and Number One posts it in every server's announcement channel. Servers without a channel only
          get urgent notices.
        </p>
      </div>

      <div className="card dev-card">
        <div className="field">
          <span>Kind</span>
          <div className="dev-types">
            {announcementTypes.map((t) => (
              <button key={t.id} type="button" className={`category ${type === t.id ? "on" : ""}`} aria-pressed={type === t.id} onClick={() => setType(t.id)}>
                <span className="category-emoji">{t.emoji}</span>
                <span>
                  <strong>{t.name}</strong>
                  <small className="muted">{t.description}</small>
                </span>
              </button>
            ))}
          </div>
          {type === "status" || type === "maintenance" ? (
            <small className="muted">
              Downtime notices have to go out <strong>before</strong> you restart or stop the bot. It can't post while it's offline. After
              it's back, send a "Back online" notice.
            </small>
          ) : null}
        </div>

        <div className="field">
          <span>Start from a template</span>
          <div className="dev-templates">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                className="btn ghost small"
                onClick={() => {
                  setType(t.type);
                  setTitle(t.title);
                  setBody(t.body);
                }}
              >
                {typeOf(t.type).emoji} {t.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Title</span>
          <input value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="Short and clear" />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea rows={7} maxLength={MAX_BODY} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened, what it means for servers, and what to do." />
          <small className="muted">
            Discord formatting works (**bold**, bullet points, links). {body.length}/{MAX_BODY}
          </small>
        </label>
        <label className="field">
          <span>“Learn more” link (optional)</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </label>

        <div className="field">
          <span>Preview</span>
          <div className="dev-preview">
            <div className="dev-embed">
              <div className="dev-embed-title">{info.emoji} {title.trim() || "Your title"}</div>
              <div className="dev-embed-body">{body.trim() || "Your message appears here."}</div>
              <div className="dev-embed-foot">Number One · {info.name}</div>
            </div>
          </div>
        </div>

        <div className="dev-audience">
          {!audience && <span className="muted small">Checking who will get this…</span>}
          {audience && (
            <>
              <strong>
                Reaches {reach} of {audience.servers} servers
              </strong>
              <ul>
                {OUTCOME_LABELS.filter(([key]) => audience.counts[key] > 0).map(([key, label]) => (
                  <li key={key} className="muted small">
                    {audience.counts[key]} {label}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="editor-actions">
          <button className="btn primary" disabled={!ready || sending || sendingNow} onClick={send}>
            {sending ? "Sending…" : sendingNow ? "Still sending the last one…" : "Send to all servers"}
          </button>
          {error && <span className="error small">{error}</span>}
        </div>
      </div>

      <h2>Sent</h2>
      {!list && <p className="muted">Loading…</p>}
      {list && list.length === 0 && <p className="muted">Nothing sent yet.</p>}
      <div className="dev-list">
        {list?.map((a) => <SentItem key={a.id} a={a} />)}
      </div>
    </section>
  );
}

function SentItem({ a }: { a: AnnouncementSummary }) {
  const t = typeOf(a.type);
  const [failures, setFailures] = useState<AnnouncementFailure[] | null>(null);
  const [error, setError] = useState("");
  const reached = a.counts.channel + a.counts.fallback;
  const handled = Object.values(a.counts).reduce((n, v) => n + v, 0);

  const showFailures = () => api.announcementFailures(a.id).then((r) => setFailures(r.failures)).catch((err) => setError(err.message));

  return (
    <article className="card dev-item">
      <div className="dev-item-head">
        <strong>{t.emoji} {a.title}</strong>
        {a.status === "sending" ? <span className="pill">Sending… {handled}/{a.servers}</span> : <span className="pill">Done</span>}
      </div>
      <div className="muted small">{new Date(a.createdAt).toLocaleString()} · {t.name}</div>
      <div className="small dev-counts">
        <span>✅ {reached} reached</span>
        <span className="muted">{a.counts["skipped-nochannel"] + a.counts["skipped-type"] + a.counts["skipped-off"]} skipped</span>
        <span className={a.counts.failed ? "warning" : "muted"}>{a.counts.failed} failed</span>
        {a.counts.failed > 0 && !failures && (
          <button className="link small" onClick={showFailures}>See why</button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
      {failures && (
        <ul className="dev-failures small">
          {failures.map((f) => (
            <li key={f.guildId}>
              <strong>{f.guildName}</strong> <span className="muted">{f.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
