import type { DocumentLayout } from "../domain/document-layout";
import type { GraphicalView } from "./projections/v5";
import type { RenderTemplate } from "../domain/model";
import { escapeHtml as e } from "./html";
import { renderNarrativeHtml } from "./narrative-html";

export function documentHeader(
  layout: DocumentLayout,
  fallbackTitle: string,
  assets: Record<string, string>,
): string {
  const h = layout.header;
  const logo = h.logo ? assets[h.logo.assetId] : null;
  if (
    h.logo &&
    (!logo ||
      !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(logo))
  )
    throw Error(
      "The header logo is unavailable. Choose the image again before exporting.",
    );
  return `<header class="document-header"><h1>${e(h.title || fallbackTitle)}</h1><div class="document-heading-row"><div class="document-identity">${logo ? `<img class="document-logo" src="${e(logo)}" alt="Organization insignia">` : ""}<div class="document-identity-lines">${h.unit ? `<strong>${e(h.unit)}</strong>` : ""}${[
    h.organization,
    h.location,
    h.dateTime,
  ]
    .filter(Boolean)
    .map((v) => `<div>${e(v)}</div>`)
    .join(
      "",
    )}</div></div>${h.classification ? `<div class="document-classification">${e(h.classification)}</div>` : ""}</div></header>`;
}
export const documentLayoutCss = `<style id="ordo-document-layout-v1">
.document-header{border:0;padding-bottom:24px;font-family:"Times New Roman",serif;color:#000;break-inside:avoid}
.document-header h1{text-align:center;font-size:28px;letter-spacing:0;margin:0 0 30px;line-height:1.2}
.document-heading-row{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;font-size:16px;line-height:1.35}
.document-identity{display:flex;align-items:center;gap:12px;min-width:0;flex:1}.document-identity-lines{min-width:0;overflow-wrap:anywhere}
.document-identity-lines strong{display:block}.document-logo{width:90px;height:90px;flex:0 0 90px;object-fit:contain}
.document-classification{max-width:30%;text-align:right;overflow-wrap:anywhere}
.document-footer{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;font:12px "Times New Roman",serif;border:0;color:#000}
.document-footer span{white-space:pre-wrap;overflow-wrap:anywhere}.document-footer span:nth-child(2){text-align:center}.document-footer span:last-child{text-align:right}
</style>`;
export function renderDocumentHtml(
  view: GraphicalView,
  provenance: string,
  template?: RenderTemplate,
  assets: Record<string, string> = {},
  graphics: { blockId: string; svg: string }[] = [],
  layout?: DocumentLayout,
): string {
  const html = renderNarrativeHtml(
    view,
    provenance,
    template,
    assets,
    graphics,
  );
  if (!layout) return html;
  // Replace only the renderer-owned framing; narrative markup cannot create these tags.
  const footer = `<footer class="document-footer"><span>${e(layout.footer.left)}</span><span>${e(layout.footer.centre)}</span><span>${e(layout.footer.right)}</span></footer>`;
  const demo = view.demo
    ? '<p class="demo">FICTIONAL DEMO — SOFTWARE DEMONSTRATION ONLY</p>'
    : "";
  return html
    .replace(
      /<header>[\s\S]*?<\/header>/,
      () => documentHeader(layout, view.title, assets) + demo,
    )
    .replace(/<footer>[\s\S]*?<\/footer>/, () => footer)
    .replace("</head>", `${documentLayoutCss}</head>`);
}
