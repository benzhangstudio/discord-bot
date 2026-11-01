import { useEffect, useMemo, useRef, useState } from "react";
import type { GuildDetails } from "../api";

type Guild = GuildDetails["guild"];

interface StandardEmoji {
  emoji: string;
  name: string;
  slug: string;
}
interface EmojiGroup {
  name: string;
  emojis: StandardEmoji[];
}

/** Newest emoji version Discord reliably shows as a reaction. Newer ones are left out of the picker. */
const MAX_EMOJI_VERSION = 15.0;

/** The full standard emoji list with names, loaded the first time a picker opens (kept out of the main page load). */
let groupsPromise: Promise<EmojiGroup[]> | null = null;
function loadStandardEmojis() {
  groupsPromise ??= import("unicode-emoji-json/data-by-group.json")
    .then((mod) => {
      const raw = (mod.default ?? mod) as unknown as {
        name: string;
        emojis: { emoji: string; name: string; slug: string; emoji_version: string }[];
      }[];
      return raw
        .filter((g) => g.name !== "Component")
        .map((g) => ({
          name: g.name,
          emojis: g.emojis
            .filter((e) => Number.parseFloat(e.emoji_version) <= MAX_EMOJI_VERSION)
            .map(({ emoji, name, slug }) => ({ emoji, name, slug })),
        }));
    })
    .catch(() => {
      groupsPromise = null; // let the next open try again
      return [];
    });
  return groupsPromise;
}

export function EmojiView({ display, url }: { display: string; url?: string | null }) {
  const custom = display.match(/^<(a?):\w+:(\d+)>$/);
  const src = url ?? (custom ? `https://cdn.discordapp.com/emojis/${custom[2]}.${custom[1] ? "gif" : "png"}?size=48` : null);
  return src ? <img className="emoji-img" src={src} alt="" width={20} height={20} /> : <span className="rr-emoji">{display}</span>;
}

/** Name to show for the picked emoji (":party_cat:" for custom ones). */
function customName(display: string) {
  return display.match(/^<a?:(\w+):\d+>$/)?.[1];
}

/** Searchable emoji picker: this server's custom emojis plus every standard emoji, searchable by name. */
export function EmojiInput({ guild, value, onChange }: { guild: Guild; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!groups) loadStandardEmojis().then(setGroups);
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, groups]);

  const q = query.trim().toLowerCase().replace(/^:|:$/g, "").replace(/[_\s]+/g, " ");
  const matches = (text: string) => text.toLowerCase().replace(/[_\s]+/g, " ").includes(q);

  const custom = useMemo(() => guild.emojis.filter((e) => !q || matches(e.name)), [guild.emojis, q]);
  const standard = useMemo(() => {
    if (!groups) return [];
    if (!q) return groups;
    const found = groups.flatMap((g) => g.emojis.filter((e) => matches(e.name) || matches(e.slug) || e.emoji === query.trim()));
    return [{ name: "Results", emojis: found.slice(0, 160) }];
  }, [groups, q]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  const first = custom[0]?.text ?? standard.find((g) => g.emojis.length)?.emojis[0]?.emoji;
  const nothing = groups && custom.length === 0 && standard.every((g) => g.emojis.length === 0);
  const label = value ? (customName(value) ? `:${customName(value)}:` : "Change") : "Pick emoji";

  return (
    <div className="emoji-input" ref={ref}>
      <button className="emoji-btn" type="button" aria-label={value ? "Change emoji" : "Pick an emoji"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {value ? <EmojiView display={value} /> : <span className="emoji-placeholder">🙂</span>}
        <span className="emoji-btn-label">{label}</span>
      </button>
      {open && (
        <div className="emoji-pop">
          <input
            autoFocus
            className="search-input"
            value={query}
            placeholder="Search emojis…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && first) {
                e.preventDefault();
                pick(first);
              } else if (e.key === "Escape") setOpen(false);
            }}
          />
          <div className="emoji-scroll">
            {custom.length > 0 && (
              <>
                <div className="muted small emoji-group">This server</div>
                <div className="emoji-grid">
                  {custom.map((e) => (
                    <button key={e.id} type="button" title={`:${e.name}:`} onClick={() => pick(e.text)}>
                      <EmojiView display={e.text} />
                    </button>
                  ))}
                </div>
              </>
            )}
            {!groups && <div className="muted small search-empty">Loading emojis…</div>}
            {standard.map(
              (g) =>
                g.emojis.length > 0 && (
                  <div key={g.name}>
                    <div className="muted small emoji-group">{g.name}</div>
                    <div className="emoji-grid">
                      {g.emojis.map((e) => (
                        <button key={e.emoji} type="button" title={e.name} onClick={() => pick(e.emoji)}>
                          {e.emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                ),
            )}
            {nothing && <div className="muted small search-empty">No emoji matches “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
