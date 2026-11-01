import { Component, type ReactNode } from "react";

/**
 * If a page crashes while drawing, show what went wrong instead of a blank screen.
 * The message is plain text so it can be copied and sent straight back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[dashboard] a page crashed:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="card" style={{ margin: "24px auto", maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>Something went wrong on this page</h2>
        <p className="muted small">Reload to try again. If it keeps happening, send this text to the developer:</p>
        <pre className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {error.name}: {error.message}
          {"\n"}
          {(error.stack ?? "").split("\n").slice(1, 6).join("\n")}
        </pre>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </section>
    );
  }
}
