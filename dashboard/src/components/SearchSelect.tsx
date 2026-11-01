import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

export interface SearchOption {
  value: string;
  label: string;
  /** Shown before the label, e.g. "#" for channels or "@" for roles. */
  prefix?: string;
  /** Text color for the label (role colors). */
  color?: string;
  disabled?: boolean;
  /** Small grey note after the label, e.g. "above my role". */
  note?: string;
}

/**
 * A dropdown with a search box: click it, type to filter, pick with the mouse or arrow keys + Enter.
 * Used for channels and roles, which can number in the hundreds on big servers.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Choose…",
  emptyLabel,
  searchPlaceholder = "Search…",
  trigger,
  className = "",
}: {
  options: SearchOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Adds a "none" choice at the top with this label. */
  emptyLabel?: string;
  searchPlaceholder?: string;
  /** Replaces what the closed dropdown shows (used by the "Add a role…" chip). */
  trigger?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[#@]/, "");
    const list: SearchOption[] = [
      ...(emptyLabel !== undefined && !q ? [{ value: "", label: emptyLabel }] : []),
      ...options.filter((o) => !q || o.label.toLowerCase().includes(q)),
    ];
    return list;
  }, [options, query, emptyLabel]);

  useEffect(() => {
    setActive(Math.max(0, shown.findIndex((o) => !o.disabled)));
  }, [shown]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (o: SearchOption) => {
    if (o.disabled) return;
    onChange(o.value || null);
    setOpen(false);
    setQuery("");
  };

  const move = (step: number) => {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + step + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  };

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`search-select ${className}`} ref={ref}>
      <button
        type="button"
        className={`search-select-btn ${trigger ? "custom" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger ?? (
          <>
            {selected ? (
              <span className="search-select-label" style={selected.color ? { color: selected.color } : undefined}>
                {selected.prefix}
                {selected.label}
              </span>
            ) : (
              <span className="muted">{value ? "Deleted or unavailable" : (emptyLabel ?? placeholder)}</span>
            )}
            <span className="muted" aria-hidden>▾</span>
          </>
        )}
      </button>
      {open && (
        <div className="search-pop">
          <input
            autoFocus
            className="search-input"
            value={query}
            placeholder={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), move(1));
              else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
              else if (e.key === "Enter") {
                e.preventDefault();
                if (shown[active]) pick(shown[active]);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="search-list" role="listbox" ref={listRef}>
            {shown.length === 0 && <div className="muted small search-empty">Nothing matches “{query}”.</div>}
            {shown.map((o, i) => (
              <button
                key={o.value || "__none"}
                type="button"
                role="option"
                data-index={i}
                aria-selected={o.value === (value ?? "")}
                disabled={o.disabled}
                className={`search-option ${i === active ? "active" : ""} ${o.value === (value ?? "") ? "selected" : ""}`}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => pick(o)}
              >
                <span style={o.color ? { color: o.color } : undefined}>
                  {o.prefix}
                  {o.label}
                </span>
                {o.note && <small className="muted">{o.note}</small>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
