import { useEffect, useRef, useState } from "react";
import type { GuildDetails } from "../api";

type Guild = GuildDetails["guild"];

const COMMON_EMOJIS = [
  "✅", "❌", "⭐", "🔥", "💖", "💜", "💙", "💚", "💛", "🧡", "🖤", "🤍",
  "🎮", "🎨", "🎵", "🎧", "📚", "💻", "🏀", "⚽", "🎬", "📸", "✈️", "🍕",
  "🔔", "📢", "🎉", "🎁", "👋", "🌙", "☀️", "🌸", "🐱", "🐶", "1️⃣", "2️⃣",
  "3️⃣", "4️⃣", "5️⃣", "🇺🇸", "🇬🇧", "🇪🇸", "🇫🇷", "🇩🇪", "🇯🇵", "🇰🇷", "🇧🇷", "🇮🇳",
];

export function EmojiView({ display, url }: { display: string; url?: string | null }) {
  const custom = display.match(/^<(a?):\w+:(\d+)>$/);
  const src = url ?? (custom ? `https://cdn.discordapp.com/emojis/${custom[2]}.${custom[1] ? "gif" : "png"}?size=48` : null);
  return src ? <img className="emoji-img" src={src} alt="" width={20} height={20} /> : <span className="rr-emoji">{display}</span>;
}

/** Text box for an emoji, with a picker of this server's custom emojis and common ones. */
export function EmojiInput({ guild, value, onChange }: { guild: Guild; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="emoji-input" ref={ref}>
      <button className="emoji-btn" type="button" aria-label="Choose emoji" onClick={() => setOpen((o) => !o)}>
        {value ? <EmojiView display={value} /> : <span className="muted">🙂</span>}
      </button>
      <input value={value} placeholder="Emoji" onChange={(e) => onChange(e.target.value)} />
      {open && (
        <div className="emoji-pop">
          {guild.emojis.length > 0 && (
            <>
              <div className="muted small">This server</div>
              <div className="emoji-grid">
                {guild.emojis.map((e) => (
                  <button key={e.id} type="button" title={`:${e.name}:`} onClick={() => pick(e.text)}>
                    <EmojiView display={e.text} />
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="muted small">Common</div>
          <div className="emoji-grid">
            {COMMON_EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => pick(e)}>{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
