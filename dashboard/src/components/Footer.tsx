import { PageLink } from "./PageLink";

export const SUPPORT_SERVER = "https://discord.gg/7GyveHcQdn";

/**
 * The footer shown on every page. App renders it once, below whichever page is open,
 * so new pages get it automatically: just add them to App's list of pages.
 */
export function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} Number One</span>
      <PageLink to="/terms">Terms of Service</PageLink>
      <PageLink to="/privacy">Privacy Policy</PageLink>
      <a href={SUPPORT_SERVER} target="_blank" rel="noopener noreferrer">
        Support
      </a>
    </footer>
  );
}
