import { categories, featureCatalog, isUsable } from "../../../src/shared/features";
import { SUPPORT_SERVER } from "../components/Footer";
import { navigate } from "../router";

/** Live features in each category, straight from the feature catalog, so this page never over-promises. */
const liveFeatures = (categoryId: string) =>
  featureCatalog.filter((f) => f.category === categoryId && isUsable(f));

const steps = [
  {
    title: "Add Number One",
    text: "Invite the bot to your server. One bot, one set of permissions.",
  },
  {
    title: "Run /setup",
    text: "Pick what your server needs. The right features switch on with sensible defaults.",
  },
  {
    title: "Fine-tune here",
    text: "Change messages, roles and rules from this dashboard. No commands to memorize.",
  },
];

const reasons = [
  {
    title: "One bot instead of five",
    text: "Fewer bots means fewer permission headaches, fewer clashing commands and a tidier member list.",
  },
  {
    title: "Works out of the box",
    text: "Every setting has a sensible default, so a fresh server is ready right after /setup.",
  },
  {
    title: "A real dashboard",
    text: "Pickers for channels and roles, live previews and plain-English settings. No config files.",
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
        <div className="sp-title">Let's set up your server</div>
        <div className="sp-text">What will you use Number One for?</div>
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
          <span className="lp-pill">All-in-one Discord bot</span>
          <h1>Run your whole server from one bot.</h1>
          <p className="lead muted">
            Moderation, member onboarding, roles and more, set up in minutes. No config files, no juggling five
            different bots.
          </p>
          {error === "login_not_configured" && (
            <p className="error">Dashboard login isn't switched on yet. The bot owner needs to finish setting it up.</p>
          )}
          {error === "invite_not_configured" && (
            <p className="error">The invite link isn't set up yet. The bot owner needs to finish setting it up.</p>
          )}
          {error === "login_failed" && <p className="error">Login didn't go through. Please try again.</p>}
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
        <h2>Everything a server needs</h2>
        <p className="muted lp-section-lead">Pick the parts you want. More arrive over time, and you can switch any of them on later.</p>
        <div className="lp-feature-grid">
          {categories.map((c) => {
            const live = liveFeatures(c.id);
            return (
              <div key={c.id} className="lp-feature-card">
                <div className="lp-feature-card-head">
                  <span className="lp-feature-emoji">{c.emoji}</span>
                  {live.length > 0 ? <span className="lp-status lp-live">Live</span> : <span className="lp-status lp-soon">Coming soon</span>}
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
        <h2>Up and running in three steps</h2>
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
        <h2>Why Number One</h2>
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
        <h2>Ready to tidy up your server?</h2>
        <p className="muted">Add the bot, run /setup, and you're done. Questions? Our support server is always open.</p>
        <div className="lp-cta-row">
          <a className="btn primary large" href="/invite">
            Add to Discord
          </a>
          <a className="btn ghost large" href={SUPPORT_SERVER} target="_blank" rel="noopener noreferrer">
            Join support server
          </a>
        </div>
      </section>
    </div>
  );
}
