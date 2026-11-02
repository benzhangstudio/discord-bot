import type { ReactNode } from "react";

/**
 * Minimal Markdown renderer for the dashboard's static pages (terms, policies).
 * Supports # and ## headings, paragraphs, "- " bullet lists, "> " banners, **bold** and [links](https://...).
 * Builds React elements directly, so text is always escaped and never injected as HTML.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.trim().split("\n").map((line) => line.trim());
        if (lines.every((line) => line.startsWith("- "))) {
          return (
            <ul key={i}>
              {lines.map((line, j) => (
                <li key={j}>{inline(line.slice(2))}</li>
              ))}
            </ul>
          );
        }
        const text = lines.join(" ");
        if (text.startsWith("> ")) return <p key={i} className="banner">{inline(text.slice(2))}</p>;
        if (text.startsWith("## ")) return <h2 key={i}>{inline(text.slice(3))}</h2>;
        if (text.startsWith("# ")) return <h1 key={i}>{inline(text.slice(2))}</h1>;
        return <p key={i}>{inline(text)}</p>;
      })}
    </>
  );
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    if (match[1] !== undefined) {
      parts.push(<strong key={at}>{match[1]}</strong>);
    } else {
      parts.push(
        <a key={at} href={match[3]} target="_blank" rel="noopener noreferrer">
          {match[2]}
        </a>,
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
