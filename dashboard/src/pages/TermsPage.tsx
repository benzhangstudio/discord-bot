import { Markdown } from "../components/Markdown";
import terms from "../content/terms.md?raw";

export function TermsPage() {
  return (
    <article className="legal">
      <Markdown source={terms} />
    </article>
  );
}
