import { richDocumentSchema, type RichNode } from "./modules";

// A typed, explicitly framed document in legacy string-valued narrative slots.
// Ordinary strings retain their original meaning and bytes until edited.
export const narrativePrefix = "[[ORDO_RICH_TEXT_V1:";
const frame = /^\[\[ORDO_RICH_TEXT_V1:([A-Za-z0-9_-]+)\]\]$/;
function boundedDocument(value: unknown): RichNode {
  let count = 0;
  const queue: [unknown, number][] = [[value, 0]];
  while (queue.length) {
    const [node, depth] = queue.pop()!;
    if (++count > 10000 || depth > 16)
      throw Error("This text is too deeply nested or too large.");
    if (node && typeof node === "object") {
      const n = node as Record<string, unknown>;
      if (n.type === "image")
        throw Error("Use an image module to attach an image.");
      if (Array.isArray(n.content))
        for (const child of n.content) queue.push([child, depth + 1]);
    }
  }
  return richDocumentSchema.parse(value);
}
export function readNarrative(value: string): RichNode {
  if (!value.startsWith(narrativePrefix))
    return {
      type: "doc",
      content: value.split("\n").map((text) => ({
        type: "paragraph",
        content: text ? [{ type: "text", text }] : [],
      })),
    };
  const encoded = frame.exec(value)?.[1];
  if (!encoded || value.length > 40000)
    throw Error("This rich-text field is malformed or exceeds its size limit.");
  const bytes = Uint8Array.from(
    atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  return boundedDocument(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
}
export function writeNarrative(value: RichNode): string {
  const doc = boundedDocument(value);
  const hasText = (n: RichNode): boolean =>
    n.type === "text" ? !!n.text?.trim() : (n.content ?? []).some(hasText);
  if (!hasText(doc))
    return (doc.content ?? [])
      .map((p) => (p.content ?? []).map((n) => n.text ?? "").join(""))
      .join("\n");
  if (
    (doc.content ?? []).every(
      (p) =>
        p.type === "paragraph" &&
        (p.content ?? []).every(
          (n) =>
            n.type === "hardBreak" || (n.type === "text" && !n.marks?.length),
        ),
    )
  )
    return (doc.content ?? [])
      .map((p) =>
        (p.content ?? [])
          .map((n) => (n.type === "hardBreak" ? "\n" : n.text))
          .join(""),
      )
      .join("\n");
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  const encoded = btoa(
    Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const out = `${narrativePrefix}${encoded}]]`;
  if (out.length > 40000)
    throw Error("This text is too long. Shorten it before saving.");
  return out;
}
export function narrativePlainText(value: string): string {
  if (!value.startsWith(narrativePrefix)) return value;
  const text = (n: RichNode): string =>
    n.type === "text"
      ? (n.text ?? "")
      : n.type === "hardBreak"
        ? "\n"
        : (n.content ?? [])
            .map(text)
            .join(n.type === "paragraph" || n.type === "heading" ? "" : "\n");
  return text(readNarrative(value));
}
export function validateNarratives(value: unknown): void {
  if (typeof value === "string") {
    if (value.startsWith(narrativePrefix)) readNarrative(value);
    return;
  }
  if (value && typeof value === "object")
    for (const child of Object.values(value)) validateNarratives(child);
}
export function hasRichNarrative(value: unknown): boolean {
  return typeof value === "string"
    ? value.includes(narrativePrefix)
    : !!value &&
        typeof value === "object" &&
        Object.values(value).some(hasRichNarrative);
}
/** Human-readable display for comparison strings that may embed quoted narratives. */
export function narrativeDisplayText(value: string): string {
  return value.replace(
    /\[\[ORDO_RICH_TEXT_V1:[A-Za-z0-9_-]+\]\]/g,
    narrativePlainText,
  );
}
