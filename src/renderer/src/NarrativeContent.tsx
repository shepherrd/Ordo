import { hasRichNarrative, readNarrative } from "../../domain/narrative";
import { richHtml } from "../../export/module-render";
export function NarrativeContent({ value }: { value: string }) {
  if (!hasRichNarrative(value))
    return (
      <div className="narrative-content" style={{ whiteSpace: "pre-wrap" }}>
        {value}
      </div>
    );
  return (
    <div
      className="narrative-content"
      dangerouslySetInnerHTML={{ __html: richHtml(readNarrative(value)) }}
    />
  );
}
