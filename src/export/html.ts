import type { ProductView } from "./projection";
import { renderTemplateSchema, type RenderTemplate } from "../domain/model";
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderHtml(
  view: ProductView,
  provenance: string,
  template?: RenderTemplate,
): string {
  if (template) renderTemplateSchema.parse(template);
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${e(view.title)}</title><style>
  body{font:14px system-ui,sans-serif;color:#172322;background:#fff;max-width:980px;margin:36px auto;padding:0 28px;line-height:1.6}header{border-bottom:3px solid ${template?.accent ?? "#2b655e"};padding-bottom:18px}h1{font-size:26px;letter-spacing:.06em;margin:4px 0}h2{font-size:16px;margin-top:28px}p{white-space:pre-wrap}small{color:#566565}.demo{font-weight:700;color:#8a5119}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #c8d2cf;padding:9px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#edf2ef}footer{border-top:1px solid #c8d2cf;margin-top:30px;padding-top:12px}body.quick-reference{font-size:12px}body.quick-reference h1{font-size:22px}body.quick-reference h2{margin-top:18px;font-size:14px}body.quick-reference td,body.quick-reference th{padding:6px}body.execution{max-width:800px} @media print{body{margin:0;max-width:none}thead{display:table-header-group}tr{break-inside:avoid}}
  </style></head><body class="${view.detail}" data-layout="${template?.layout ?? "legacy"}"><header><small>ORDO / DERIVED PRODUCT</small><h1>${e(view.title)}</h1><strong>${e(view.operationName)} · ${e(view.orderNumber)}</strong>${view.demo ? '<p class="demo">FICTIONAL DEMO — SOFTWARE DEMONSTRATION ONLY</p>' : ""}</header>${view.sections
    .map(
      (s) =>
        `<section><h2>${e(s.title)}</h2>${s.text !== undefined ? `<p>${e(s.text || "Not entered.")}</p>` : ""}${
          s.rows
            ? s.rows.length
              ? `<table><thead><tr>${Object.keys(s.rows[0])
                  .map((k) => `<th>${e(k)}</th>`)
                  .join("")}</tr></thead><tbody>${s.rows
                  .map(
                    (row) =>
                      `<tr>${Object.values(row)
                        .map((v) => `<td>${e(v)}</td>`)
                        .join("")}</tr>`,
                  )
                  .join("")}</tbody></table>`
              : "<p>No matching records.</p>"
            : ""
        }</section>`,
    )
    .join("")}<footer><small>${e(provenance)}</small></footer></body></html>`;
}
