import { renderHtml, escapeHtml } from "./html";
import type { ModularView } from "./projections/v4";
import type { RenderTemplate } from "../domain/model";
export function renderModularHtml(
  view: ModularView,
  provenance: string,
  template?: RenderTemplate,
  assets: Record<string, string> = {},
): string {
  if (!view.sections.some((s) => s.moduleHtml !== undefined))
    return renderHtml(view, provenance, template);
  const sections = view.sections
    .map((s) =>
      s.moduleHtml !== undefined
        ? `<section><h2>${escapeHtml(s.title)}</h2>${s.moduleHtml.replace(
            /src="asset:([0-9a-f-]{36})"/g,
            (_all, id: string) => {
              const data = assets[id];
              if (
                !data ||
                !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(
                  data,
                )
              )
                return 'alt="Missing managed image"';
              return `src="${data}"`;
            },
          )}</section>`
        : (renderHtml({ ...view, sections: [s] }, "", template).match(
            /<section>[\s\S]*<\/section>/,
          )?.[0] ?? ""),
    )
    .join("");
  return renderHtml({ ...view, sections: [] }, provenance, template).replace(
    "<footer>",
    `${sections}<footer>`,
  );
}
