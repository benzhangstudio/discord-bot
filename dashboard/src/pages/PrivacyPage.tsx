import { Markdown } from "../components/Markdown";
import privacy from "../content/privacy.md?raw";

export function PrivacyPage() {
  return (
    <article className="legal">
      <Markdown source={privacy} />
    </article>
  );
}
