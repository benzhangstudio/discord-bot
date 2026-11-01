import { useEffect, useState } from "react";
import type { DashboardGuild } from "../../../src/shared/features";
import { api, guildIconUrl, inviteUrl } from "../api";
import { navigate } from "../router";

export function ServersPage() {
  const [guilds, setGuilds] = useState<DashboardGuild[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.guilds(), api.config()])
      .then(([g, c]) => {
        setGuilds(g);
        setClientId(c.clientId);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!guilds) return <p className="muted">Loading your servers…</p>;

  return (
    <section>
      <h1>Your servers</h1>
      <p className="muted">Servers where you have the Manage Server permission.</p>
      {guilds.length === 0 && <p className="muted">You don't manage any servers yet.</p>}
      <div className="guild-grid">
        {guilds.map((g) => (
          <div key={g.id} className="card guild-card">
            <GuildIcon guild={g} />
            <div className="guild-name">{g.name}</div>
            {g.botPresent ? (
              <button className="btn primary small" onClick={() => navigate(`/servers/${g.id}`)}>
                Manage
              </button>
            ) : (
              <a className="btn ghost small" href={inviteUrl(clientId, g.id)} target="_blank" rel="noreferrer">
                Add bot
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function GuildIcon({ guild, size = 56 }: { guild: { id: string; name: string; icon: string | null }; size?: number }) {
  const url = guildIconUrl(guild);
  return url ? (
    <img className="guild-icon" src={url} alt="" width={size} height={size} />
  ) : (
    <div className="guild-icon fallback" style={{ width: size, height: size }}>
      {guild.name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 3)}
    </div>
  );
}
