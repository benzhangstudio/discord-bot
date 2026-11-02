import { useEffect, useState } from "react";
import type { DashboardUser } from "../../src/shared/features";
import { api, avatarUrl } from "./api";
import { Footer } from "./components/Footer";
import { GuildPage } from "./pages/GuildPage";
import { HomePage } from "./pages/HomePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ServersPage } from "./pages/ServersPage";
import { TermsPage } from "./pages/TermsPage";
import { navigate, usePath } from "./router";

export function App() {
  const path = usePath();
  const [user, setUser] = useState<DashboardUser | null | undefined>(undefined); // undefined = still checking

  useEffect(() => {
    // Any failure (usually "not logged in") shows the login page.
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <div className="app">
        <main className="content center muted">Loading…</main>
        <Footer />
      </div>
    );
  }

  const guildMatch = path.match(/^\/servers\/(\d+)(?:\/([\w-]+))?/);
  // Every page is rendered inside the layout below (top bar, page, footer). Add new pages to this list.
  let page;
  if (path === "/terms") page = <TermsPage />; // public: readable without logging in
  else if (path === "/privacy") page = <PrivacyPage />; // public too
  else if (!user) page = <HomePage />;
  else if (guildMatch) page = <GuildPage guildId={guildMatch[1]} page={guildMatch[2] ?? ""} />;
  else if (path.startsWith("/servers")) page = <ServersPage />;
  else page = <HomePage loggedIn />;

  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate(user ? "/servers" : "/");
          }}
        >
          <span className="brand-mark">#1</span> Number One
        </a>
        {user && (
          <div className="user">
            {avatarUrl(user) ? <img src={avatarUrl(user)!} alt="" /> : <span className="avatar-fallback">{user.username[0]}</span>}
            <span>{user.username}</span>
            <button
              className="btn ghost small"
              onClick={async () => {
                await api.logout();
                window.location.href = "/";
              }}
            >
              Log out
            </button>
          </div>
        )}
      </header>
      <main className={`content ${user && guildMatch ? "wide" : ""}`}>{page}</main>
      <Footer />
    </div>
  );
}
