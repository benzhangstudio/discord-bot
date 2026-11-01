import { useEffect, useState } from "react";
import { type FeatureState, featureCatalog } from "../../../src/shared/features";
import { type GuildDetails, api } from "../api";
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

      <h2>Features</h2>
      <div className="feature-list">
        {featureCatalog.map((info) => {
          const state = data.features.find((f) => f.id === info.id);
          if (!state) return null;
          return (
            <div key={info.id} className="card feature-card">
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
          );
        })}
      </div>
    </section>
  );
}
