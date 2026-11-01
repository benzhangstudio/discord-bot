import { useEffect, useState } from "react";
import {
  type CategoryId,
  type FeatureInfo,
  type FeatureState,
  categories,
  featureCatalog,
  featuresInCategory,
} from "../../../src/shared/features";
import { type GuildDetails, api } from "../api";
import { featurePanels } from "../features";
import { navigate } from "../router";
import { GuildIcon } from "./ServersPage";

export function GuildPage({ guildId }: { guildId: string }) {
  const [data, setData] = useState<GuildDetails | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.guild(guildId).then(setData).catch((err) => setError(err.message));
  }, [guildId]);

  if (error)
    return (
      <section>
        <p className="error">{error}</p>
        <button className="btn ghost" onClick={() => navigate("/servers")}>
          Back to servers
        </button>
      </section>
    );
  if (!data) return <p className="muted">Loading server…</p>;

  const toggle = async (state: FeatureState) => {
    setSaving(state.id);
    try {
      const updated = await api.saveFeature(guildId, state.id, { enabled: !state.enabled, settings: state.settings });
      setData({ ...data, features: data.features.map((f) => (f.id === updated.id ? updated : f)) });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const renderFeature = (info: FeatureInfo) => {
    const state = data.features.find((f) => f.id === info.id);
    if (!state) return null;
    const Panel = featurePanels[info.id];
    return (
      <div key={info.id} className="card feature-block">
        <div className="feature-card">
          <div>
            <div className="feature-name">{info.name}</div>
            <div className="muted">{info.description}</div>
          </div>
          {info.alwaysOn ? (
            <span className="pill">Always on</span>
          ) : (
            <button
              className={`switch ${state.enabled ? "on" : ""}`}
              role="switch"
              aria-checked={state.enabled}
              aria-label={`Turn ${info.name} ${state.enabled ? "off" : "on"}`}
              disabled={saving === info.id}
              onClick={() => toggle(state)}
            >
              <span />
            </button>
          )}
        </div>
        {Panel && state.enabled && <Panel guild={data.guild} />}
        {Panel && !state.enabled && <p className="muted small panel-off">Turn this on to start using it.</p>}
      </div>
    );
  };

  const core = featureCatalog.filter((f) => !f.category);
  const groups = categories.filter((c) => featuresInCategory(c.id).length > 0);

  return (
    <section>
      <button className="link" onClick={() => navigate("/servers")}>
        ← All servers
      </button>
      <div className="guild-header">
        <GuildIcon guild={data.guild} size={64} />
        <div>
          <h1>{data.guild.name}</h1>
          <p className="muted">{data.guild.memberCount.toLocaleString()} members</p>
        </div>
      </div>

      <SetupCard data={data} onChange={setData} />

      <h2>Features</h2>
      <div className="feature-list">{core.map(renderFeature)}</div>
      {groups.map((c) => (
        <div key={c.id}>
          <h3 className="group-title">
            {c.emoji} {c.name}
          </h3>
          <div className="feature-list">{featuresInCategory(c.id).map(renderFeature)}</div>
        </div>
      ))}
    </section>
  );
}

/** The dashboard version of /setup: pick what the server is for, recommended features switch on. */
function SetupCard({ data, onChange }: { data: GuildDetails; onChange: (d: GuildDetails) => void }) {
  const [picked, setPicked] = useState<CategoryId[]>(data.setup.categories);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(!data.setup.completed);

  const dirty = picked.slice().sort().join() !== data.setup.categories.slice().sort().join();

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const result = await api.saveSetup(data.guild.id, picked);
      onChange({ ...data, setup: result.setup, features: result.features });
      const names = result.turnedOn.map((id) => featureCatalog.find((f) => f.id === id)?.name).filter(Boolean);
      setMessage(names.length ? `Switched on: ${names.join(", ")}.` : "Saved. Everything you picked is already on.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    const chosen = categories.filter((c) => data.setup.categories.includes(c.id));
    return (
      <div className="card setup-summary">
        <div>
          <div className="feature-name">Used for</div>
          <div className="muted">{chosen.map((c) => `${c.emoji} ${c.name}`).join(" · ") || "Nothing picked yet"}</div>
        </div>
        <button className="btn ghost small" onClick={() => setOpen(true)}>Change</button>
      </div>
    );
  }

  return (
    <div className="card setup-card">
      <div className="feature-name">What will you use Number One for?</div>
      <p className="muted">Pick everything that fits. The right features switch on for each one. Same as <code>/setup</code> in Discord.</p>
      <div className="category-grid">
        {categories.map((c) => {
          const on = picked.includes(c.id);
          const ready = featuresInCategory(c.id).length > 0;
          return (
            <button
              key={c.id}
              className={`category ${on ? "on" : ""}`}
              aria-pressed={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
            >
              <span className="category-emoji">{c.emoji}</span>
              <span>
                <strong>{c.name}</strong>
                <small className="muted">{c.description}</small>
                {!ready && <small className="soon">Coming soon</small>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="editor-actions">
        <button className="btn primary" disabled={saving || picked.length === 0 || (!dirty && data.setup.completed)} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        {data.setup.completed && (
          <button className="btn ghost" onClick={() => { setPicked(data.setup.categories); setOpen(false); }}>Close</button>
        )}
        {message && <span className="muted small">{message}</span>}
      </div>
    </div>
  );
}
