import type { ReactNode } from "react";
import { navigate } from "../router";

/** A link to another dashboard page (e.g. /privacy) that switches pages without reloading. */
export function PageLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let "open in new tab" work
        e.preventDefault();
        navigate(to);
        window.scrollTo(0, 0);
      }}
    >
      {children}
    </a>
  );
}
