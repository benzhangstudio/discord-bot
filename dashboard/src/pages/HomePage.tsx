import { categories, featureCatalog, isUsable } from "../../../src/shared/features";
import { SUPPORT_SERVER } from "../components/Footer";
import { navigate } from "../router";

/** Live features in each category, straight from the feature catalog, so this page never over-promises. */
const liveFeatures = (categoryId: string) =>
  featureCatalog.filter((f) => f.category === categoryId && isUsable(f));

const steps = [
  {
    title: "Invite",
    text: "Add Number One to a server. Requires Manage Server.",
  },
  {
    title: "Run /setup",
    text: "Select categories. Matching modules are enabled with default settings.",
  },
  {
    title: "Configure",
    text: "Edit messages, roles and rules in the dashboard.",
  },
];

const reasons = [
  {
    title: "Single bot",
    text: "Replaces several single-purpose bots. One permission set. One command list.",
  },
  {
    title: "Defaults included",
    text: "Every setting has a default value. Operational immediately after /setup.",
  },
  {
    title: "Web dashboard",
    text: "Channel and role pickers. Message previews. No config files.",
  },
];

function DashboardButton({ loggedIn, className }: { loggedIn: boolean; className: string }) {
  return loggedIn ? (
    <button className={className} onClick={() => navigate("/servers")}>
      Choose a server
    </button>
  ) : (
    <a className={className} href="/auth/login">
      Log in with Discord
    </a>
  );
}

/** A small mock of the /setup message, so visitors see what the bot looks like in Discord. */
function SetupPreview() {
  return (
    <div className="setup-preview" aria-hidden="true">
      <div className="sp-head">
        <span className="sp-avatar">#1</span>
        <span className="sp-name">Number One</span>
        <span className="sp-tag">APP</span>
      </div>
      <div className="sp-embed">
        <div className="sp-title">What will you use Number One for?</div>
        <div className="sp-text">Pick everything that fits your server.</div>
        <div className="sp-options">
          {categories.slice(0, 4).map((c, i) => (
            <div key={c.id} className={`sp-option ${i < 3 ? "on" : ""}`}>
              <span className="sp-check">{i < 3 ? "✓" : ""}</span>
              <span>{c.emoji}</span>
              <span>{c.name}</span>
            </div>
          ))}
        </div>
        <div className="sp-button">Start setup</div>
      </div>
    </div>
  );
}

export function HomePage({ loggedIn = false }: { loggedIn?: boolean }) {
  const error = new URLSearchParams(window.location.search).get("error");

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero-text">
          <span className="lp-pill">Discord administration bot</span>
          <h1>One bot. All server administration.</h1>
          <p className="lead muted">
            Moderation, auto-moderation, member onboarding and role management. Configured with /setup and this
            dashboard.
          </p>
          {error === "login_not_configured" && (
            <p className="error">Error: dashboard login is not configured.</p>
          )}
          {error === "invite_not_configured" && (
            <p className="error">Error: invite link is not configured.</p>
          )}
          {error === "login_failed" && <p className="error">Error: login failed. Retry.</p>}
          <div className="lp-cta-row">
            <a className="btn primary large" href="/invite">
              Add to Discord
            </a>
            <DashboardButton loggedIn={loggedIn} className="btn ghost large" />
          </div>
        </div>
        <SetupPreview />
      </section>

      <section id="features" className="landing-section">
        <h2>Modules</h2>
        <p className="muted lp-section-lead">Enabled per server. Additional modules are in development.</p>
        <div className="lp-feature-grid">
          {categories.map((c) => {
            const live = liveFeatures(c.id);
            return (
              <div key={c.id} className="lp-feature-card">
                <div className="lp-feature-card-head">
                  <span className="lp-feature-emoji">{c.emoji}</span>
                  {live.length > 0 ? <span className="lp-status lp-live">Available</span> : <span className="lp-status lp-soon">In development</span>}
                </div>
                <h3>{c.name}</h3>
                <p className="muted">{c.description}</p>
                {live.length > 0 && (
                  <ul className="lp-feature-list">
                    {live.map((f) => (
                      <li key={f.id}>
                        <span>{f.icon}</span> {f.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section id="how" className="landing-section">
        <h2>Setup</h2>
        <ol className="lp-steps">
          {steps.map((s, i) => (
            <li key={s.title} className="lp-step">
              <span className="lp-step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section">
        <h2>Specifications</h2>
        <div className="lp-reasons">
          {reasons.map((r) => (
            <div key={r.title} className="lp-reason">
              <h3>{r.title}</h3>
              <p className="muted">{r.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <h2>Add Number One</h2>
        <p className="muted">Invite, run /setup, configure. Support is handled in the Discord server.</p>
        <div className="lp-cta-row">
          <a className="btn primary large" href="/invite">
            Add to Discord
          </a>
          <a className="btn ghost large" href={SUPPORT_SERVER} target="_blank" rel="noopener noreferrer">
            Support server
          </a>
        </div>
      </section>
    </div>
  );
}
