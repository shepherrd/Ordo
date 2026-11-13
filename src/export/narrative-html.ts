import { readNarrative } from "../domain/narrative";
import { richHtml } from "./module-render";
import { renderGraphicalHtml } from "./graphical-html";
import type { GraphicalView } from "./projections/v5";
import type { RenderTemplate } from "../domain/model";

/** html-v4 only. Earlier renderer implementations remain untouched. */
export function expandNarratives(html: string): string {
  // Renderer-generated markup has quoted/escaped attributes. Substitute text
  // tokens only, never attribute values, scripts, styles or retained SVG bytes.
  let protectedDepth = 0;
  const tokens = html.split(/(<[^>]*>)/g),
    paragraphs: boolean[] = [];
  return tokens
    .map((part, index) => {
      if (part.startsWith("<")) {
        if (
          /^<(?:svg|script|style|title)\b/i.test(part) &&
          !part.endsWith("/>")
        )
          protectedDepth++;
        if (/^<\/(?:svg|script|style|title)\s*>/i.test(part))
          protectedDepth = Math.max(0, protectedDepth - 1);
        if (!protectedDepth && /^<p(?:\s|>)/i.test(part)) {
          let contains = false;
          for (
            let i = index + 1;
            i < tokens.length && !/^<\/p\s*>/i.test(tokens[i]);
            i++
          )
            if (
              !tokens[i].startsWith("<") &&
              tokens[i].includes("[[ORDO_RICH_TEXT_V1:")
            )
              contains = true;
          paragraphs.push(contains);
          if (contains) return part.replace(/^<p/i, "<div");
        } else if (
          !protectedDepth &&
          /^<\/p\s*>/i.test(part) &&
          paragraphs.pop()
        )
          return "</div>";
        return part;
      }
      return protectedDepth
        ? part
        : part.replace(/\[\[ORDO_RICH_TEXT_V1:[A-Za-z0-9_-]+\]\]/g, (match) =>
            richHtml(readNarrative(match)),
          );
    })
    .join("");
}
export function renderNarrativeHtml(
  view: GraphicalView,
  provenance: string,
  template?: RenderTemplate,
  assets: Record<string, string> = {},
  graphics: { blockId: string; svg: string }[] = [],
): string {
  return expandNarratives(
    renderGraphicalHtml(view, graphics, provenance, template, assets),
  );
}
