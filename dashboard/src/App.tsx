import { useEffect, useState } from "react";
import type { DashboardUser } from "../../src/shared/features";
import { api, avatarUrl } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DeveloperPage } from "./pages/DeveloperPage";
import { GuildPage } from "./pages/GuildPage";
import { HomePage } from "./pages/HomePage";
import { ServersPage } from "./pages/ServersPage";
import { navigate, usePath } from "./router";

export function App() {
  const path = usePath();
  const [user, setUser] = useState<DashboardUser | null | undefined>(undefined); // undefined = still checking

  useEffect(() => {
    // Any failure (usually "not logged in") shows the login page.
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="center muted">Loading…</div>;

  const guildMatch = path.match(/^\/servers\/(\d+)(?:\/([\w-]+))?/);
  let page;
  if (!user) page = <HomePage />;
  else if (path === "/developer") page = <DeveloperPage />;
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
            {user.developer && (
              <a
                className="btn ghost small"
                href="/developer"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/developer");
                }}
              >
                📢 Developer
              </a>
            )}
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
      <main className={`content ${user && guildMatch ? "wide" : ""}`}><ErrorBoundary key={path}>{page}</ErrorBoundary></main>
    </div>
  );
}
