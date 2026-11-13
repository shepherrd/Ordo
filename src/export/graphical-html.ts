import { renderModularHtml } from "./modular-html";
import type { GraphicalView } from "./projections/v5";
import type { RenderTemplate } from "../domain/model";

/** The application verifies generated SVG and provenance before composition. */
export function renderGraphicalHtml(
  view: GraphicalView,
  graphics: readonly { blockId: string; svg: string }[],
  provenance: string,
  template?: RenderTemplate,
  assets: Record<string, string> = {},
): string {
  const used = new Set<string>();
  const sections = view.sections.map((section) => {
    if (!section.graphic) return section;
    const matches = graphics.filter(
      (g) => g.blockId === section.graphic!.blockId,
    );
    if (matches.length !== 1)
      throw Error("Missing or duplicate verified order graphic");
    used.add(matches[0].blockId);
    return {
      ...section,
      moduleHtml: `<div class="task-organization-graphic">${matches[0].svg}</div>`,
    };
  });
  if (used.size !== graphics.length) throw Error("Unconsumed order graphic");
  return renderModularHtml(
    { ...view, sections },
    provenance,
    template,
    assets,
  ).replace(
    "</style>",
    ".task-organization-graphic{overflow:auto}.task-organization-graphic>svg{max-width:100%;height:auto}@media print{.task-organization-graphic{overflow:visible;break-inside:avoid}}</style>",
  );
}
