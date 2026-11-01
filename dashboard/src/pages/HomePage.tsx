import { navigate } from "../router";

export function HomePage({ loggedIn = false }: { loggedIn?: boolean }) {
  const error = new URLSearchParams(window.location.search).get("error");
  return (
    <section className="hero">
      <h1>Run your whole server from one bot.</h1>
      <p className="muted">
        Moderation, welcomes, roles, logging and more, set up in minutes from this dashboard. No config files, no juggling
        five different bots.
      </p>
      {error === "login_not_configured" && (
        <p className="error">Dashboard login isn't switched on yet. The bot owner needs to finish setting it up.</p>
      )}
      {error === "login_failed" && <p className="error">Login didn't go through. Please try again.</p>}
      {loggedIn ? (
        <button className="btn primary" onClick={() => navigate("/servers")}>
          Choose a server
        </button>
      ) : (
        <a className="btn primary" href="/auth/login">
          Log in with Discord
        </a>
      )}
    </section>
  );
}
