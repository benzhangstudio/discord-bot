import { type ReactNode, useEffect, useState } from "react";
import {
  type CategoryId,
  type DashboardGuild,
  type FeatureInfo,
  type FeatureState,
  categories,
  featureCatalog,
  featuresInCategory,
  isUsable,
} from "../../../src/shared/features";
import { type GuildDetails, api } from "../api";
import { featurePanels } from "../features";
import { navigate } from "../router";
import { GuildIcon } from "./ServersPage";

/**
 * A server's dashboard, laid out like MEE6 / Carl-bot:
 * a menu on the left (Overview, Server setup, then each category and its features)
 * and one page at a time on the right.
 *
 * Pages: /servers/:id (overview), /servers/:id/setup, /servers/:id/:featureId
 */
export function GuildPage({ guildId, page }: { guildId: string; page: string }) {
  const [data, setData] = useState<GuildDetails | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setData(null);
    setError("");
    api.guild(guildId).then(setData).catch((err) => setError(err.message));
  }, [guildId]);

  // Close the phone menu and jump to the top whenever the page changes.
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [page, guildId]);

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

  const stateOf = (id: string) => data.features.find((f) => f.id === id);

  const setEnabled = async (info: FeatureInfo, enabled: boolean) => {
    const state = stateOf(info.id);
    if (!state) return;
    setSaving(info.id);
    try {
      const updated = await api.saveFeature(guildId, info.id, { enabled, settings: state.settings });
      setData((d) => d && { ...d, features: d.features.map((f) => (f.id === updated.id ? updated : f)) });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const base = `/servers/${guildId}`;
  const feature = featureCatalog.find((f) => f.id === page && f.category);

  let body;
  let title = "Overview";
  if (page === "setup") {
    title = "Server setup";
    body = <SetupPage data={data} onChange={setData} />;
  } else if (feature) {
    title = feature.name;
    body = (
      <FeaturePage
        info={feature}
        state={stateOf(feature.id)}
        guild={data.guild}
        saving={saving === feature.id}
        onToggle={(on) => setEnabled(feature, on)}
      />
    );
  } else {
    body = (
      <OverviewPage
        data={data}
        base={base}
        saving={saving}
        onToggle={(info, on) => setEnabled(info, on)}
      />
    );
  }

  const link = (to: string, label: ReactNode, active: boolean, extra?: ReactNode) => (
    <a
      href={to}
      className={`nav-item ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
      {extra}
    </a>
  );

  return (
    <div className="guild-layout">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <ServerSwitcher current={data.guild} />
        <button className="menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          <span>{title}</span>
          <span aria-hidden>{menuOpen ? "▲" : "▼"}</span>
        </button>
        <nav className="nav">
          {link(base, <><span className="nav-icon">🏠</span>Overview</>, !feature && page !== "setup")}
          {link(
            `${base}/setup`,
            <><span className="nav-icon">⚙️</span>Server setup</>,
            page === "setup",
            !data.setup.completed ? <span className="nav-badge">Start here</span> : null,
          )}
          {categories.map((c) => {
            const list = featuresInCategory(c.id);
            return (
              <div key={c.id} className="nav-group">
                <div className="nav-heading">{c.name}</div>
                {list.length === 0 && <div className="nav-soon">Coming soon</div>}
                {list.map((f) =>
                  link(
                    `${base}/${f.id}`,
                    <><span className="nav-icon">{f.icon ?? "•"}</span>{f.name}</>,
                    feature?.id === f.id,
                    f.workInProgress ? (
                      <span className="nav-badge wip" title="Work in progress">WIP</span>
                    ) : (
                      <span className={`nav-dot ${stateOf(f.id)?.enabled ? "on" : ""}`} title={stateOf(f.id)?.enabled ? "On" : "Off"} />
                    ),
                  ),
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="guild-main">{body}</div>
    </div>
  );
}

/** Server name and icon at the top of the menu. Click to jump to another server. */
function ServerSwitcher({ current }: { current: GuildDetails["guild"] }) {
  const [open, setOpen] = useState(false);
  const [guilds, setGuilds] = useState<DashboardGuild[] | null>(null);

  useEffect(() => {
    if (open && !guilds) api.guilds().then(setGuilds).catch(() => setGuilds([]));
  }, [open, guilds]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  const others = (guilds ?? []).filter((g) => g.botPresent && g.id !== current.id);

  return (
    <div className="switcher" onClick={(e) => e.stopPropagation()}>
      <button className="switcher-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <GuildIcon guild={current} size={36} />
        <span className="switcher-name">
          <strong>{current.name}</strong>
          <small className="muted">{current.memberCount.toLocaleString()} members</small>
        </span>
        <span className="muted" aria-hidden>⇅</span>
      </button>
      {open && (
        <div className="switcher-menu">
          {!guilds && <div className="muted small switcher-empty">Loading…</div>}
          {others.map((g) => (
            <button key={g.id} onClick={() => { setOpen(false); navigate(`/servers/${g.id}`); }}>
              <GuildIcon guild={g} size={24} />
              <span>{g.name}</span>
            </button>
          ))}
          {guilds && others.length === 0 && <div className="muted small switcher-empty">No other servers yet.</div>}
          <button className="switcher-all" onClick={() => { setOpen(false); navigate("/servers"); }}>
            ← All servers
          </button>
        </div>
      )}
    </div>
  );
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      className={`switch ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={`Turn ${label} ${on ? "off" : "on"}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    >
      <span />
    </button>
  );
}

/** Home page for a server: a card per feature, grouped by category, each with a switch and a Configure button. */
function OverviewPage({
  data,
  base,
  saving,
  onToggle,
}: {
  data: GuildDetails;
  base: string;
  saving: string | null;
  onToggle: (info: FeatureInfo, on: boolean) => void;
}) {
  const groups = categories.filter((c) => featuresInCategory(c.id).length > 0);
  const soon = categories.filter((c) => featuresInCategory(c.id).length === 0);
  const usable = featureCatalog.filter(isUsable);
  const enabledCount = data.features.filter((f) => f.enabled && usable.some((i) => i.id === f.id)).length;
  const total = usable.length;

  return (
    <section>
      <div className="page-head">
        <h1>Overview</h1>
        <p className="muted">
          {enabledCount} of {total} features on. Open a feature to set it up, or use the switches to turn things on and off.
        </p>
      </div>

      {!data.setup.completed && (
        <div className="card banner">
          <div>
            <div className="feature-name">New here? Start with server setup</div>
            <div className="muted">Tell Number One what your server needs and the right features switch on for you.</div>
          </div>
          <button className="btn primary" onClick={() => navigate(`${base}/setup`)}>
            Set up
          </button>
        </div>
      )}

      {groups.map((c) => (
        <div key={c.id} className="overview-group">
          <h2>
            {c.emoji} {c.name}
          </h2>
          <div className="plugin-grid">
            {featuresInCategory(c.id).map((info) => {
              const state = data.features.find((f) => f.id === info.id);
              if (!state) return null;
              const go = () => navigate(`${base}/${info.id}`);
              if (info.workInProgress) {
                return (
                  <div key={info.id} className="card plugin wip">
                    <div className="plugin-top">
                      <span className="plugin-icon">{info.icon ?? c.emoji}</span>
                      <span className="pill wip-pill">🚧 Work in progress</span>
                    </div>
                    <div className="feature-name">{info.name}</div>
                    <p className="muted small plugin-desc">{info.description}</p>
                    <button className="btn ghost small" onClick={go}>
                      Details →
                    </button>
                  </div>
                );
              }
              return (
                <div key={info.id} className={`card plugin ${state.enabled ? "on" : ""}`}>
                  <div className="plugin-top">
                    <span className="plugin-icon">{info.icon ?? c.emoji}</span>
                    <Switch on={state.enabled} label={info.name} disabled={saving === info.id} onChange={(on) => onToggle(info, on)} />
                  </div>
                  <div className="feature-name">{info.name}</div>
                  <p className="muted small plugin-desc">{info.description}</p>
                  <button className="btn ghost small" onClick={go}>
                    Configure →
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {soon.length > 0 && (
        <div className="overview-group">
          <h2>Coming soon</h2>
          <div className="soon-list">
            {soon.map((c) => (
              <div key={c.id} className="card soon-card">
                <span className="plugin-icon">{c.emoji}</span>
                <div>
                  <div className="feature-name">{c.name}</div>
                  <div className="muted small">{c.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="muted small footnote">
        Always on: <code>/setup</code>, <code>/dashboard</code> and <code>/ping</code>.
      </p>

      <DeleteDataCard data={data} />
    </section>
  );
}

/** Lets the server owner delete everything Number One stores about the server (Discord requires an easy way). */
function DeleteDataCard({ data }: { data: GuildDetails }) {
  const [busy, setBusy] = useState(false);
  const { guild, isOwner } = data;

  const remove = async () => {
    const typed = prompt(
      `This removes Number One from ${guild.name} and permanently deletes all of its settings and data for this server. ` +
        `Messages and roles it already created stay in your server.\n\nType the server name to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim() !== guild.name.trim()) return alert("The name didn't match, so nothing was deleted.");
    setBusy(true);
    try {
      await api.deleteGuildData(guild.id);
      alert(`Done. Number One has left ${guild.name} and its data has been deleted.`);
      navigate("/servers");
    } catch (err) {
      alert((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="overview-group">
      <h2>Your data</h2>
      <div className="card danger-card">
        <div>
          <div className="feature-name">Remove Number One and delete all data</div>
          <div className="muted small">
            {isOwner
              ? "Removes the bot from this server and permanently deletes everything it stores about it."
              : "Only the server owner can do this. If Number One is removed from a server, its data is deleted automatically after 30 days."}
          </div>
        </div>
        <button className="btn danger" disabled={!isOwner || busy} onClick={remove}>
          {busy ? "Deleting…" : "Delete all data"}
        </button>
      </div>
    </div>
  );
}

/** One feature on its own page: header with the on/off switch, then its settings. */
function FeaturePage({
  info,
  state,
  guild,
  saving,
  onToggle,
}: {
  info: FeatureInfo;
  state: FeatureState | undefined;
  guild: GuildDetails["guild"];
  saving: boolean;
  onToggle: (on: boolean) => void;
}) {
  const Panel = featurePanels[info.id];
  const category = categories.find((c) => c.id === info.category);
  const on = !!state?.enabled;

  return (
    <section className="feature-page">
      <div className="page-head feature-head">
        <span className="plugin-icon big">{info.icon ?? category?.emoji}</span>
        <div className="feature-head-text">
          {category && <div className="muted small">{category.name}</div>}
          <h1>{info.name}</h1>
          <p className="muted">{info.description}</p>
        </div>
        {state && !info.workInProgress && <Switch on={on} label={info.name} disabled={saving} onChange={onToggle} />}
      </div>

      {info.workInProgress ? (
        <div className="card enable-card wip-card">
          <div className="plugin-icon big">🚧</div>
          <div className="feature-name">Work in progress</div>
          <p className="muted">
            {info.name} is being reworked and is locked for now. It's paused in every server until it's ready, so nothing
            from it runs in the meantime.
          </p>
          <p className="muted small">
            Any settings you saved are kept and will come back when it returns. If your server picked {category?.name ?? "its category"}{" "}
            in setup, it switches on by itself once it's finished.
          </p>
        </div>
      ) : !on ? (
        <div className="card enable-card">
          <div className="plugin-icon big">{info.icon ?? category?.emoji}</div>
          <div className="feature-name">{info.name} is off</div>
          <p className="muted">Turn it on to start setting it up. Nothing changes in your server until you save something.</p>
          <button className="btn primary" disabled={saving} onClick={() => onToggle(true)}>
            {saving ? "Turning on…" : "Turn on"}
          </button>
        </div>
      ) : Panel ? (
        <div className="feature-body">
          <Panel guild={guild} />
        </div>
      ) : (
        <p className="muted">This feature is on. It has no settings yet.</p>
      )}
    </section>
  );
}

/** The dashboard version of /setup: pick what the server is for, recommended features switch on. */
function SetupPage({ data, onChange }: { data: GuildDetails; onChange: (d: GuildDetails) => void }) {
  const [picked, setPicked] = useState<CategoryId[]>(data.setup.categories);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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

  return (
    <section>
      <div className="page-head">
        <h1>Server setup</h1>
        <p className="muted">
          What will you use Number One for? Pick everything that fits and the recommended features for each switch on. Same as{" "}
          <code>/setup</code> in Discord. You can still turn any feature on or off later.
        </p>
      </div>
      <div className="category-grid">
        {categories.map((c) => {
          const on = picked.includes(c.id);
          const list = featuresInCategory(c.id);
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
                {list.length === 0 ? (
                  <small className="soon">Coming soon</small>
                ) : (
                  <small className="includes">
                    Includes: {list.map((f) => (f.workInProgress ? `${f.name} (work in progress)` : f.name)).join(", ")}
                  </small>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="editor-actions">
        <button className="btn primary" disabled={saving || picked.length === 0 || (!dirty && data.setup.completed)} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        {message && <span className="muted small">{message}</span>}
      </div>
    </section>
  );
}
